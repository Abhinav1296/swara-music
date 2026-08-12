"""Lyrics layer — Journey 1, step (4): find lyrics, match the anchor, store all versions.

A small framework + one adapter per source. Design:

  * Every source is a `LyricsSource` with a `.fetch(song)` returning a *version*
    (or None). Adding a source = ~30 lines; nothing else changes.
  * Fetches go through curl_cffi (browser impersonation) so most Cloudflare
    walls are a non-issue.
  * Every candidate is validated against the JioSaavn anchor (title + duration)
    and Telugu-script fenced, so we never staple the wrong / wrong-language
    words onto a song.
  * We KEEP ALL versions (multi-source). `chosen_source` = highest-priority one
    present (LyricStape #1); a later A/B vote can flip `chosen_reason` to "votes".
  * Re-runnable: new versions MERGE into a song, preserving A/B counts, so a
    higher-priority source added later upgrades `chosen_source` without wiping
    anything.

Run (fills songs currently at status="pending_lyrics"):
    python -m scraper.lyrics            # default 25 songs
    python -m scraper.lyrics 200
"""
from __future__ import annotations

import html
import json
import re
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from difflib import SequenceMatcher
from typing import Any, Dict, List, Optional
from urllib.parse import quote_plus, urljoin

from bs4 import BeautifulSoup
from curl_cffi import requests as cffi

from scraper import db

# Trust ranking (1 = highest). Build-order is separate; this is what users see.
PRIORITY = {
    "jiosaavn": 1,        # exact JioSaavn-ID match — guaranteed-correct song
    "lyricstape": 2,
    "telugulyrics_com": 3,
    "genius": 4,          # native Telugu script, validated internal-search match
    "lrclib": 5,          # low reading-trust, but a karaoke (synced) source
    "musixmatch": 6,      # native Telugu + romanized + synced (fuzzy matcher → lower trust)
}

_TELUGU = re.compile(r"[ఀ-౿]")
_LRC_STAMP = re.compile(r"\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]")


class TransientError(Exception):
    """Raised by a source on a TRANSIENT failure (rate-limit, Cloudflare, network,
    bad token). The source is then NOT recorded in `lyrics_tried`, so the song is
    retried on a later run. A genuine 'no match' returns None instead (and IS marked
    tried, so we don't re-fetch it forever). Essential for the rate-limited web
    sources (Genius/Musixmatch) during a large paced fill."""


# ── helpers ──────────────────────────────────────────────────────────────────
def _norm(s: Optional[str]) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def is_telugu(text: Optional[str], min_chars: int = 20) -> bool:
    return len(_TELUGU.findall(text or "")) >= min_chars


def parse_lrc(text: str) -> List[Dict[str, Any]]:
    """Parse '[mm:ss.xx] words' lines into [{timeMs, text}], time-sorted."""
    out: List[Dict[str, Any]] = []
    for line in (text or "").splitlines():
        stamps = list(_LRC_STAMP.finditer(line))
        if not stamps:
            continue
        content = line[stamps[-1].end():].strip()
        for m in stamps:
            mm, ss, frac = int(m.group(1)), int(m.group(2)), (m.group(3) or "0")
            ms = (mm * 60 + ss) * 1000 + int(frac.ljust(3, "0")[:3])
            out.append({"timeMs": ms, "text": content})
    out.sort(key=lambda x: x["timeMs"])
    return out


def make_version(source: str, *, text_telugu: str = "", text_roman: str = "",
                 synced: Optional[List] = None, raw: str = "", url: str = "",
                 romanized_only: bool = False) -> Dict[str, Any]:
    return {
        "source": source,
        "priority": PRIORITY.get(source, 99),
        "text_telugu": text_telugu,
        "text_roman": text_roman,
        "synced": synced or [],
        "raw": raw,
        "url": url,
        # True => real, correct lyrics but not Telugu script; stored & visible,
        # yet NEVER eligible to become the chosen (pure) lyric.
        "romanized_only": romanized_only,
        "wins": 0,          # A/B: times a user preferred this version
        "comparisons": 0,   # A/B: times it appeared in a match-up
    }


# ── source framework ─────────────────────────────────────────────────────────
class LyricsSource:
    name = "base"

    def fetch(self, song: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        raise NotImplementedError


class LRCLibSource(LyricsSource):
    """Clean JSON API. Pure-Telugu plain + synced (karaoke) LRC. No auth."""
    name = "lrclib"

    def fetch(self, song: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        title = song.get("title") or ""
        dur = song.get("duration_sec")
        # Query by TITLE only — artist names differ across sources (JioSaavn's
        # singer vs LRCLib's composer). Duration is the strong anchor instead.
        try:
            r = cffi.get("https://lrclib.net/api/search", params={"q": title},
                         impersonate="chrome", timeout=20)
            results = r.json() if r.status_code == 200 else []
        except Exception:
            return None

        # Collect ALL title/duration matches, best score first.
        matched = []
        for it in results or []:
            t_sim = SequenceMatcher(None, _norm(title), _norm(it.get("trackName"))).ratio()
            d = it.get("duration")
            dur_match = bool(dur and d and abs(d - dur) <= 4)
            # A strong duration match carries a song even when the title has a
            # '- From <movie>' suffix; otherwise require a solid title match.
            if not (dur_match or t_sim >= 0.62):
                continue
            matched.append((t_sim + (2.0 if dur_match else 0.0), it))
        if not matched:
            return None
        matched.sort(key=lambda x: x[0], reverse=True)

        # A song has several LRCLib entries; only some carry the Telugu-script
        # version. Prefer a Telugu one; fall back to the best match otherwise
        # (kept as romanized) instead of discarding the song.
        best = next((it for _, it in matched
                     if is_telugu(it.get("plainLyrics")) or is_telugu(it.get("syncedLyrics"))),
                    matched[0][1])

        plain = (best.get("plainLyrics") or "").strip()
        synced_raw = best.get("syncedLyrics") or ""
        if not (plain or synced_raw):
            return None  # matched the song but it has no actual lyrics text

        return make_version(
            self.name,
            text_telugu=plain if is_telugu(plain) else "",
            text_roman="" if is_telugu(plain) else plain,
            synced=parse_lrc(synced_raw),
            raw=synced_raw or plain,
            url=f"https://lrclib.net/api/get/{best.get('id')}" if best.get("id") else "",
        )


class TeluguLyricsComSource(LyricsSource):
    """telugulyrics.com — WordPress /?s= search, /lyrics/<slug>/ pages.

    The `.lyrics` block carries BOTH romanized (English) and Telugu-script
    lyrics, so this source fills text_roman AND text_telugu at once.
    """
    name = "telugulyrics_com"
    BASE = "https://telugulyrics.com"

    def _find_page(self, title: str) -> Optional[str]:
        try:
            r = cffi.get(f"{self.BASE}/?s={quote_plus(title)}", impersonate="chrome", timeout=25)
            if r.status_code != 200:
                return None
        except Exception:
            return None
        soup = BeautifulSoup(r.text, "html.parser")
        norm_t = _norm(title)
        first2 = _norm(" ".join(title.split()[:2]))
        best, best_sim, seen = None, 0.0, set()
        for a in soup.select("a[href]"):
            h = urljoin(self.BASE, a.get("href", ""))
            if "/lyrics/" not in h.lower() or h in seen:
                continue
            seen.add(h)
            slug = _norm(h.rstrip("/").rsplit("/", 1)[-1])
            sim = SequenceMatcher(None, norm_t, slug).ratio()
            if len(first2) >= 4 and first2 in slug:   # strong: song's first words in slug
                sim = max(sim, 0.85)
            if sim > best_sim:
                best, best_sim = h, sim
        return best if best_sim >= 0.4 else None

    def fetch(self, song: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        link = self._find_page(song.get("title") or "")
        if not link:
            return None
        try:
            r = cffi.get(link, impersonate="chrome", timeout=25)
            if r.status_code != 200:
                return None
        except Exception:
            return None
        soup = BeautifulSoup(r.text, "html.parser")
        node = soup.select_one(".lyrics") or soup.select_one(".entry-content")
        if not node:
            return None
        for t in node.select("script,style,nav,footer,header,form,button"):
            t.decompose()

        telugu_lines, roman_lines = [], []
        for raw_line in node.get_text("\n").splitlines():
            line = raw_line.strip()
            if len(line) < 2:
                continue
            low = line.lower()
            if low in ("lyric", "lyrics", "print", "share") or "advertisement" in low or "telugulyrics.com" in low:
                continue
            if _TELUGU.search(line):
                telugu_lines.append(line)
            elif re.search(r"[a-zA-Z]", line):
                roman_lines.append(line)

        text_telugu = "\n".join(telugu_lines).strip()
        text_roman = "\n".join(roman_lines).strip()
        if not is_telugu(text_telugu) and len(text_roman) < 80:
            return None  # nothing usable

        return make_version(self.name, text_telugu=text_telugu, text_roman=text_roman,
                            raw=node.get_text("\n").strip(), url=link)


class LyricStapeSource(LyricsSource):
    """LyricStape via the pre-crawled `lyricstape_index` (movie -> album -> songs).

    Needs `python -m scraper.lyricstape` to have built the index first. Looks up
    our song by movie name + title, fetches the page, and extracts BOTH the
    Telugu-script lyrics (main content) and the romanized version (.unselectable).
    """
    name = "lyricstape"
    _albums = None  # class-level cache of the index (loaded once per process)

    def _index(self) -> List[Dict[str, Any]]:
        if LyricStapeSource._albums is None:
            col = db.get_collection("lyricstape_index")
            LyricStapeSource._albums = [
                {"movie": a.get("movie") or "", "songs": a.get("songs") or []}
                for a in col.find({"movie": {"$ne": None}}, {"movie": 1, "songs": 1})
                if a.get("songs")
            ]
        return LyricStapeSource._albums

    def fetch(self, song: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        movie = _norm(song.get("movie") or "")
        norm_title = _norm(song.get("title") or "")
        if not movie or not norm_title:
            return None

        # 1) best-matching album by movie name
        album, album_sim = None, 0.0
        for alb in self._index():
            sim = SequenceMatcher(None, movie, _norm(alb["movie"])).ratio()
            if sim > album_sim:
                album, album_sim = alb, sim
        if not album or album_sim < 0.6:
            return None

        # 2) best-matching song by title within that album
        best, best_sim = None, 0.0
        for sg in album["songs"]:
            st = _norm(sg.get("title"))
            sim = SequenceMatcher(None, norm_title, st).ratio()
            if st and (norm_title in st or st in norm_title):
                sim = max(sim, 0.85)
            if sim > best_sim:
                best, best_sim = sg, sim
        if not best or best_sim < 0.5:
            return None

        # 3) fetch the song page and extract both scripts
        try:
            r = cffi.get(best["url"], impersonate="chrome", timeout=20)
            if r.status_code != 200:
                return None
        except Exception:
            return None
        text_telugu, text_roman = self._extract(r.text)
        if not is_telugu(text_telugu) and len(text_roman) < 80:
            return None
        return make_version(self.name, text_telugu=text_telugu, text_roman=text_roman,
                            raw=(text_telugu or text_roman), url=best["url"])

    @staticmethod
    def _extract(html: str):
        soup = BeautifulSoup(html, "html.parser")
        telugu, roman = [], []
        content = soup.select_one(".entry-content") or soup.select_one("article")
        if content:
            for t in content.select("script,style,nav,footer,header,form,button,ins"):
                t.decompose()
            for line in content.get_text("\n").splitlines():
                line = line.strip()
                if _TELUGU.search(line):
                    telugu.append(line)
        uns = soup.select_one(".unselectable")
        if uns:
            for line in uns.get_text("\n").splitlines():
                line = line.strip()
                if len(line) > 1 and re.search(r"[a-zA-Z]", line) and not _TELUGU.search(line):
                    roman.append(line)
        return "\n".join(telugu).strip(), "\n".join(roman).strip()


class JioSaavnLyricsSource(LyricsSource):
    """JioSaavn's own lyrics, fetched by the exact `jiosaavn_id` we already store.

    This is the *most* trustworthy match we have: no fuzzy title/duration
    guessing — it's the very id we use to stream the audio, so the lyric is
    guaranteed to belong to this song. Coverage is thin (JioSaavn only carries
    lyrics for a minority of songs) and frequently romanized. Only the SCRIPT
    decides the tier:
      * Telugu-script  -> normal version, joins the pure pool (can be chosen).
      * romanized      -> stored but flagged `romanized_only`, so it is visible
                          yet NEVER becomes the chosen (pure) lyric.
    """
    name = "jiosaavn"
    API = "https://www.jiosaavn.com/api.php"
    PARAMS = {"_format": "json", "_marker": "0", "api_version": "4", "ctx": "web6dot0"}

    def fetch(self, song: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        sid = song.get("jiosaavn_id")
        if not sid:
            return None
        params = {**self.PARAMS, "__call": "lyrics.getLyrics", "lyrics_id": sid}
        try:
            r = cffi.get(self.API, params=params, impersonate="chrome", timeout=20)
            if r.status_code != 200:
                return None
            data: Any = r.json()
        except Exception:
            return None
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except Exception:
                return None
        if not isinstance(data, dict):
            return None
        raw = data.get("lyrics")
        if not raw:
            return None
        text = html.unescape(re.sub(r"<br\s*/?>", "\n", str(raw))).strip()
        if len(text) < 20:
            return None
        url = song.get("perma_url") or ""
        if is_telugu(text):
            return make_version(self.name, text_telugu=text, raw=text, url=url)
        # Romanized 'Tenglish' — correct song, wrong script. Keep it, flagged.
        return make_version(self.name, text_roman=text, raw=text, url=url,
                            romanized_only=True)


class GeniusSource(LyricsSource):
    """Genius via its keyless internal search (genius.com/api/search/multi) + page
    scrape. Native Telugu script for popular film songs. Genius search is fuzzy, so
    we VALIDATE the hit against our title+singer before trusting it — never staple a
    same-titled different song's words. Plain text only (no synced). Cloudflare needs
    browser impersonation (curl_cffi), so non-200s are treated as transient."""
    name = "genius"
    SEARCH = "https://genius.com/api/search/multi"

    def fetch(self, song: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        title = song.get("title") or ""
        singers = song.get("singers") or ""
        lead = re.split(r"[,&/]", singers)[0].strip() if singers else ""
        try:
            r = cffi.get(self.SEARCH, params={"q": f"{title} {lead}"},
                         impersonate="chrome", timeout=20)
        except Exception as exc:
            raise TransientError(str(exc))
        if r.status_code != 200:
            raise TransientError(f"search {r.status_code}")
        try:
            data = r.json()
        except Exception:
            raise TransientError("search not json")
        hits = []
        for sec in (data.get("response") or {}).get("sections") or []:
            for h in sec.get("hits") or []:
                if h.get("type") == "song":
                    res = h.get("result") or {}
                    if res.get("url"):
                        hits.append((res.get("title") or "",
                                     (res.get("primary_artist") or {}).get("name") or "",
                                     res["url"]))
        nt = _norm(title)
        stoks = [_norm(s) for s in re.split(r"[,&/]", singers) if len(s.strip()) > 2]
        for ht, ha, url in hits:
            if "genius" in _norm(ha):     # skip "Genius Romanizations"/"Genius English…"
                continue
            ts = SequenceMatcher(None, nt, _norm(ht)).ratio()
            title_ok = ts >= 0.72 or (len(nt) >= 5 and (nt in _norm(ht) or _norm(ht) in nt))
            artist_ok = any(s and s in _norm(f"{ht} {ha}") for s in stoks)
            if not (title_ok and (artist_ok or ts >= 0.85)):
                continue
            text = self._page(url)
            if is_telugu(text):
                return make_version(self.name, text_telugu=text, raw=text, url=url)
            if text and len(text) >= 80:  # real romanized lyric: stored & visible, not chosen
                return make_version(self.name, text_roman=text, raw=text, url=url,
                                    romanized_only=True)
        return None

    @staticmethod
    def _page(url: str) -> str:
        try:
            r = cffi.get(url, impersonate="chrome", timeout=20)
        except Exception as exc:
            raise TransientError(str(exc))
        if r.status_code != 200:
            raise TransientError(f"page {r.status_code}")
        soup = BeautifulSoup(r.text, "html.parser")
        conts = soup.find_all(attrs={"data-lyrics-container": "true"})
        if not conts:
            return ""
        for br in soup.find_all("br"):
            br.replace_with("\n")
        raw = "\n".join(c.get_text() for c in conts)
        # strip Genius "<n> Contributors…Romanization…<Title> Lyrics" page-chrome.
        # No \b after 'Lyrics': Telugu letters are word-chars, so a boundary never fires.
        if re.match(r"^.{0,400}?(Contributor|Romanization|Translation)", raw, re.S):
            raw = re.sub(r"^.*?Lyrics", "", raw, count=1, flags=re.S)
        out = []
        for ln in raw.splitlines():
            ln = ln.strip()
            if not ln or (ln.startswith("[") and ln.endswith("]")):   # [Verse], [Chorus: X]
                continue
            out.append(re.sub(r"\d*Embed$", "", ln))
        return "\n".join(o for o in out if o).strip()


class MusixmatchSource(LyricsSource):
    """Musixmatch via the keyless community desktop-app token. Gives native Telugu
    script + romanized + time-SYNCED (LRC) karaoke — the only synced-capable web
    source we have besides LRCLib. matcher.track.get is fuzzy, so we validate the
    matched track_name against our title. The anon token is rate-limited; on an
    auth/quota status we drop the token and raise TransientError (retry later)."""
    name = "musixmatch"
    ROOT = "https://apic-desktop.musixmatch.com/ws/1.1"
    APP = "web-desktop-app-v1.0"
    _lock = threading.Lock()
    _sess = None
    _tok = None

    @classmethod
    def _token(cls):
        with cls._lock:
            if cls._tok:
                return cls._sess, cls._tok
            s = cffi.Session(impersonate="chrome")
            try:
                r = s.get(f"{cls.ROOT}/token.get",
                          params={"app_id": cls.APP, "format": "json"}, timeout=20)
                tok = (((r.json() or {}).get("message") or {}).get("body") or {}).get("user_token")
            except Exception:
                tok = None
            cls._sess, cls._tok = s, tok
            return s, tok

    @classmethod
    def _reset_token(cls):
        with cls._lock:
            cls._sess, cls._tok = None, None

    def _call(self, path: str, params: Dict[str, Any]) -> Dict[str, Any]:
        s, tok = self._token()
        if not tok:
            raise TransientError("no token")
        try:
            r = s.get(f"{self.ROOT}/{path}",
                      params={"app_id": self.APP, "usertoken": tok, "format": "json", **params},
                      timeout=20)
            j = r.json()
        except Exception as exc:
            raise TransientError(str(exc))
        code = ((j.get("message") or {}).get("header") or {}).get("status_code")
        if code in (401, 402, 403):       # auth/quota/captcha → drop token, retry later
            self._reset_token()
            raise TransientError(f"status {code}")
        return (j.get("message") or {}).get("body") or {}

    def fetch(self, song: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        title = song.get("title") or ""
        singers = song.get("singers") or ""
        lead = re.split(r"[,&/]", singers)[0].strip() if singers else ""
        tr = self._call("matcher.track.get", {"q_track": title, "q_artist": lead}).get("track") or {}
        if not tr:
            return None
        if SequenceMatcher(None, _norm(title), _norm(tr.get("track_name"))).ratio() < 0.6:
            return None                    # fuzzy match rejected → protect authenticity
        if not tr.get("has_lyrics"):
            return None
        cid = tr.get("commontrack_id")
        url = tr.get("track_share_url") or ""
        lyr = self._call("track.lyrics.get", {"commontrack_id": cid}).get("lyrics") or {}
        plain = re.sub(r"\*+ This Lyrics.*", "", (lyr.get("lyrics_body") or "")).strip()
        if not plain:
            return None
        synced = []
        try:                               # synced is a bonus — never fail the fetch for it
            sub = self._call("track.subtitles.get",
                             {"commontrack_id": cid, "subtitle_format": "lrc"}).get("subtitle_list") or []
            if sub:
                synced = parse_lrc((sub[0].get("subtitle") or {}).get("subtitle_body") or "")
        except TransientError:
            synced = []
        if is_telugu(plain):
            return make_version(self.name, text_telugu=plain, synced=synced, raw=plain, url=url)
        return make_version(self.name, text_roman=plain, synced=synced, raw=plain, url=url,
                            romanized_only=True)


# Enabled sources for the default fill(). JioSaavn is deliberately NOT here: it's
# an exact-id fallback run on its own over songs with no pure lyric yet
# (see fill_jiosaavn), so it never re-litigates already-chosen songs.
SOURCES: List[LyricsSource] = [LRCLibSource(), TeluguLyricsComSource(), LyricStapeSource(),
                               GeniusSource(), MusixmatchSource()]
JIOSAAVN = JioSaavnLyricsSource()


# ── merge + persist ──────────────────────────────────────────────────────────
def build_lyrics_update(song_doc: Dict[str, Any],
                        fetched: List[Dict[str, Any]],
                        attempted: List[str]) -> Dict[str, Any]:
    """Merge freshly-fetched versions into a song, preserving A/B counts.

    `attempted` = source names tried this run; recorded in `lyrics_tried` so a
    source that found nothing isn't re-fetched forever (only new sources are).
    """
    existing = {v["source"]: v for v in (song_doc.get("lyrics_versions") or [])}
    for v in fetched:
        old = existing.get(v["source"])
        if old:  # keep the votes this source already earned
            v["wins"] = old.get("wins", 0)
            v["comparisons"] = old.get("comparisons", 0)
        existing[v["source"]] = v

    versions = sorted(existing.values(), key=lambda v: v["priority"])
    tried = sorted(set(song_doc.get("lyrics_tried") or []) | set(attempted) | set(existing.keys()))

    if not versions:
        return {"lyrics_versions": [], "lyrics_missing": True, "needs_sync": True,
                "status": "lyrics_not_found", "romanized_only_available": False,
                "lyrics_tried": tried}

    # Romanized-only versions (e.g. JioSaavn 'Tenglish') are kept & visible but
    # are NEVER eligible to be the chosen pure lyric.
    pure = [v for v in versions if not v.get("romanized_only")]
    synced_v = next((v for v in versions if v.get("synced")), None)
    has_roman_only = any(v.get("romanized_only") for v in versions)

    if pure:
        return {
            "lyrics_versions": versions,
            "chosen_source": pure[0]["source"],
            "chosen_reason": "priority",
            "synced_source": synced_v["source"] if synced_v else None,
            "lyrics_missing": False,
            "needs_sync": synced_v is None,
            "status": "has_lyrics",
            "romanized_only_available": has_roman_only,
            "lyrics_tried": tried,
        }
    # Only a flagged romanized version exists: no pure lyric, but keep it visible.
    return {
        "lyrics_versions": versions,
        "chosen_source": None,
        "chosen_reason": None,
        "synced_source": synced_v["source"] if synced_v else None,
        "lyrics_missing": True,           # still no PURE lyric
        "needs_sync": True,
        "status": "romanized_only",
        "romanized_only_available": True,
        "lyrics_tried": tried,
    }


def _fetch_song(doc: Dict[str, Any]) -> Dict[str, Any]:
    """Fetch a single song's not-yet-tried sources IN PARALLEL and merge.

    Fetching the ≤3 sources concurrently is the safe speedup: each source hits a
    different site, so a song issues at most one request per site at a time. Pure
    (no DB write) so it's easy to test; the caller persists the returned update.
    """
    already = set(doc.get("lyrics_tried")
                  or [v["source"] for v in (doc.get("lyrics_versions") or [])])
    todo = [s for s in SOURCES if s.name not in already]
    fetched: List[Dict[str, Any]] = []
    attempted: List[str] = []
    if todo:
        with ThreadPoolExecutor(max_workers=len(todo)) as ex:
            for s, (v, transient) in zip(todo, ex.map(lambda s: _safe_fetch(s, doc), todo)):
                if not transient:
                    attempted.append(s.name)   # transient failures aren't marked tried → retried later
                if v:
                    fetched.append(v)
    return build_lyrics_update(doc, fetched, attempted)


def _safe_fetch(source: LyricsSource, doc: Dict[str, Any]):
    """Returns (version_or_None, transient?). A transient failure (rate-limit,
    Cloudflare, network) is retried on a later run; a genuine miss (None, False) is
    recorded as tried so we don't re-fetch it forever. One dead source never kills
    the song."""
    try:
        return source.fetch(doc), False
    except TransientError:
        return None, True
    except Exception:
        return None, False


def fill(limit: int = 25, workers: int = 3) -> None:
    """Fill lyrics for songs that haven't tried every enabled source yet.

    Concurrency is deliberately gentle: `workers` songs are processed at once,
    and within each song its pending sources are fetched in parallel — so any one
    lyric site sees at most ~`workers` requests at a time. Re-runnable and
    idempotent: only not-yet-tried sources are fetched, then merged (A/B counts
    preserved). Progress is flushed per line so a redirected log stays live.
    """
    col = db.get_songs_collection()
    enabled = [s.name for s in SOURCES]
    # A song needs work if it's missing at least one enabled source in lyrics_tried.
    # Skip tracks tagged non-lyrical (BGM/OST/theme) — see scraper.classify.
    query = {"no_lyrics_expected": {"$ne": True},
             "$or": [{"lyrics_tried": {"$ne": name}} for name in enabled]}
    docs = list(col.find(query, limit=limit))
    total = len(docs)
    print(f"processing {total} song(s) x {len(enabled)} sources, {workers} parallel "
          f"({enabled})\n", flush=True)

    # Warm the LyricStape index once, before the pool, so workers don't all load it.
    for s in SOURCES:
        if isinstance(s, LyricStapeSource):
            s._index()

    lock = threading.Lock()
    st = {"i": 0, "with": 0, "empty": 0, "err": 0}

    def work(doc: Dict[str, Any]) -> None:
        title = doc.get("title", "?")
        try:
            update = _fetch_song(doc)
            col.update_one({"_id": doc["_id"]}, {"$set": update})
        except Exception as exc:
            with lock:
                st["i"] += 1; st["err"] += 1
                print(f"  [{st['i']:>4}/{total}] {title:<30.30} ERROR {str(exc)[:30]}", flush=True)
            return
        got = ", ".join(v["source"] for v in update["lyrics_versions"]
                        if v["source"] not in (doc.get("lyrics_tried") or [])) or "nothing new"
        with lock:
            st["i"] += 1
            st["empty" if update["lyrics_missing"] else "with"] += 1
            print(f"  [{st['i']:>4}/{total}] {title:<30.30} "
                  f"got: {got:<26} versions={len(update['lyrics_versions'])}", flush=True)

    with ThreadPoolExecutor(max_workers=workers) as ex:
        list(ex.map(work, docs))

    print(f"\ndone: {st['with']} with lyrics, {st['empty']} still empty, "
          f"{st['err']} errors", flush=True)


def fill_jiosaavn(limit: int = 25, workers: int = 3) -> None:
    """Exact-id fallback pass: try JioSaavn's own lyrics on songs that still have
    NO pure lyric (`lyrics_missing`) and carry a `jiosaavn_id`, and haven't tried
    jiosaavn yet. Telugu-script hits become the song's pure lyric; romanized hits
    are stored flagged (never chosen). Re-runnable and idempotent.
    """
    col = db.get_songs_collection()
    query = {"lyrics_missing": True,
             "no_lyrics_expected": {"$ne": True},
             "jiosaavn_id": {"$nin": [None, ""]},
             "lyrics_tried": {"$ne": JIOSAAVN.name}}
    docs = list(col.find(query, limit=limit))
    total = len(docs)
    print(f"jiosaavn pass: {total} empty song(s) with a jiosaavn_id, "
          f"{workers} parallel\n", flush=True)

    lock = threading.Lock()
    st = {"i": 0, "telugu": 0, "roman": 0, "none": 0, "err": 0}

    def work(doc: Dict[str, Any]) -> None:
        title = doc.get("title", "?")
        try:
            v, _ = _safe_fetch(JIOSAAVN, doc)
            update = build_lyrics_update(doc, [v] if v else [], [JIOSAAVN.name])
            col.update_one({"_id": doc["_id"]}, {"$set": update})
        except Exception as exc:
            with lock:
                st["i"] += 1; st["err"] += 1
                print(f"  [{st['i']:>4}/{total}] {title:<30.30} ERROR {str(exc)[:30]}", flush=True)
            return
        kind = "none" if v is None else ("roman" if v.get("romanized_only") else "telugu")
        with lock:
            st["i"] += 1; st[kind] += 1
            print(f"  [{st['i']:>4}/{total}] {title:<30.30} jiosaavn: {kind}", flush=True)

    with ThreadPoolExecutor(max_workers=workers) as ex:
        list(ex.map(work, docs))

    print(f"\ndone: {st['telugu']} pure Telugu (net-new), "
          f"{st['roman']} romanized-flagged, {st['none']} no lyrics, "
          f"{st['err']} errors", flush=True)


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    argv = sys.argv[1:]
    if argv and argv[0] == "jiosaavn":       # exact-id fallback over empties
        argv = argv[1:]
        n = int(argv[0]) if argv and argv[0].isdigit() else 25
        w = int(argv[1]) if len(argv) > 1 and argv[1].isdigit() else 3
        fill_jiosaavn(n, w)
    else:                                    # default 3-source fill
        n = int(argv[0]) if argv and argv[0].isdigit() else 25
        w = int(argv[1]) if len(argv) > 1 and argv[1].isdigit() else 3
        fill(n, w)
