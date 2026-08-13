"""Manual quarantine review — listen and one-click classify, in your browser.

Your own ear is the most reliable Telugu detector we have. This serves the parked
quarantine songs one at a time with an audio player (auto-seeked past the intro)
and four choices; each click writes the verdict straight to MongoDB and advances.
Zero dependencies (Python's stdlib http.server), fully local, resumable — stop
anytime and re-run to pick up where you left off.

    python -m scraper.review_server
    -> then open  http://localhost:8765  in your browser

Keys / buttons:
  T  Telugu   -> promote to swara.songs           (telugu_proof="manual_ear")
  B  BGM      -> promote as instrumental / score   (telugu_proof="manual_bgm")
  F  Foreign  -> park as quarantine_foreign (never shown again)
  S  Skip     -> leave parked, offer it again next run
  U  Undo     -> revert the last verdict (fixes a misclick)
  Space       -> play / pause

Nothing here guesses: Telugu/BGM are YOUR judgment (the strongest proof there is),
Foreign only hides, Skip does nothing. Every action is reversible.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qs, urlparse

from scraper import db
from scraper.expand_movies import get_quarantine_collection
from scraper.jiosaavn import resolve_stream

HOST = "127.0.0.1"
PORT = 8765

# Parked candidates the jury/lyrics haven't resolved, minus any already hand-reviewed.
_PARKED_STATUSES = ["quarantine", "quarantine_unproven", "quarantine_audio_unproven"]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── data ─────────────────────────────────────────────────────────────────────
def _queue() -> List[Dict[str, Any]]:
    quar = get_quarantine_collection()
    cur = quar.find(
        {"status": {"$in": _PARKED_STATUSES}, "reviewed_manual": {"$ne": True}},
        {"title": 1, "movie": 1, "year": 1, "duration_sec": 1, "singers": 1,
         "p3_movie": 1, "p3_year": 1, "lyrics_tried": 1},
    ).sort("p3_year", -1)
    out = []
    for d in cur:
        out.append({
            "id": d["_id"],
            "title": d.get("title", "?"),
            "movie": d.get("movie") or d.get("p3_movie") or "",
            "year": d.get("year") or d.get("p3_year") or "",
            "duration": d.get("duration_sec") or 0,
            "singers": d.get("singers") or "",
            "had_lyrics": bool(d.get("lyrics_tried")),
        })
    return out


def _counts() -> Dict[str, int]:
    quar = get_quarantine_collection()
    songs = db.get_songs_collection()
    return {
        "remaining": quar.count_documents(
            {"status": {"$in": _PARKED_STATUSES}, "reviewed_manual": {"$ne": True}}),
        "telugu": songs.count_documents({"telugu_proof": "manual_ear"}),
        "bgm": songs.count_documents({"telugu_proof": "manual_bgm"}),
        "foreign": quar.count_documents({"status": "quarantine_foreign", "reviewed_manual": True}),
    }


# ── verdicts (all reversible) ────────────────────────────────────────────────
def _promote(doc: Dict[str, Any], as_bgm: bool) -> None:
    songs = db.get_songs_collection()
    quar = get_quarantine_collection()
    p = dict(doc)
    p.pop("quarantine_reason", None)
    p["language"] = "telugu"
    p["language_jiosaavn"] = doc.get("language", "")
    p["promoted_from_quarantine"] = True
    p["reviewed_manual"] = True
    p["updated_at"] = _now()
    p.setdefault("created_at", _now())
    p["_id"] = doc["_id"]
    if as_bgm:
        p["telugu_proof"] = "manual_bgm"
        p["is_instrumental"] = True
        p["status"] = "instrumental_no_lyrics"
    else:
        p["telugu_proof"] = "manual_ear"
        p["status"] = "pending_lyrics"
    songs.replace_one({"_id": doc["_id"]}, p, upsert=True)
    quar.delete_one({"_id": doc["_id"]})


def _apply(song_id: str, verdict: str) -> bool:
    """Apply a verdict. Returns True if something changed."""
    quar = get_quarantine_collection()
    if verdict in ("telugu", "bgm"):
        doc = quar.find_one({"_id": song_id})
        if not doc:
            return False
        _promote(doc, as_bgm=(verdict == "bgm"))
        return True
    if verdict == "foreign":
        return quar.update_one(
            {"_id": song_id},
            {"$set": {"status": "quarantine_foreign", "reviewed_manual": True,
                      "reviewed_at": _now(), "updated_at": _now()}},
        ).matched_count > 0
    if verdict == "skip":
        return True  # no state change; just move on
    return False


def _undo(song_id: str) -> bool:
    """Revert the last verdict for a song back to a plain parked candidate."""
    songs = db.get_songs_collection()
    quar = get_quarantine_collection()
    doc = songs.find_one({"_id": song_id, "promoted_from_quarantine": True})
    if doc:  # it was promoted (telugu/bgm) -> pull it back into quarantine
        back = dict(doc)
        for k in ("telugu_proof", "is_instrumental", "promoted_from_quarantine",
                  "reviewed_manual", "language_jiosaavn"):
            back.pop(k, None)
        back["language"] = doc.get("language_jiosaavn", "") or "unknown"
        back["status"] = "quarantine_unproven"
        back["updated_at"] = _now()
        back["_id"] = song_id
        quar.replace_one({"_id": song_id}, back, upsert=True)
        songs.delete_one({"_id": song_id})
        return True
    # else it was foreign/skip -> just clear the review flag
    return quar.update_one(
        {"_id": song_id},
        {"$set": {"status": "quarantine_unproven", "updated_at": _now()},
         "$unset": {"reviewed_manual": "", "reviewed_at": ""}},
    ).matched_count > 0


# ── HTML (single self-contained page) ────────────────────────────────────────
PAGE = """<!doctype html><html><head><meta charset="utf-8">
<title>Swara — Quarantine Review</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#0f1115;color:#e8eaed;
       display:flex;flex-direction:column;align-items:center;min-height:100vh}
  header{width:100%;text-align:center;padding:14px 0;background:#151922;border-bottom:1px solid #232a36}
  header b{color:#8ab4f8}
  .card{background:#151922;border:1px solid #232a36;border-radius:16px;padding:26px 30px;margin-top:34px;
        width:min(620px,92vw);box-shadow:0 8px 30px rgba(0,0,0,.35)}
  .title{font-size:26px;font-weight:700;margin:0 0 4px}
  .meta{color:#9aa4b2;font-size:15px;margin-bottom:6px}
  .tag{display:inline-block;font-size:12px;color:#c7d0dc;background:#232a36;border-radius:999px;
       padding:2px 10px;margin-right:6px}
  audio{width:100%;margin:18px 0 22px}
  .btns{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  button.v{font-size:17px;font-weight:600;padding:16px;border:0;border-radius:12px;cursor:pointer;color:#0f1115}
  .telugu{background:#7ee787}.bgm{background:#79c0ff}.foreign{background:#ff7b72}.skip{background:#8b949e}
  button.v:hover{filter:brightness(1.08)}
  .k{opacity:.6;font-weight:700;font-size:13px}
  .row{display:flex;gap:14px;justify-content:center;margin-top:16px;font-size:14px;color:#9aa4b2}
  .row b{color:#e8eaed}
  #undo{margin-top:18px;background:transparent;color:#9aa4b2;border:1px solid #333b48;border-radius:10px;
        padding:8px 14px;cursor:pointer}
  #done{font-size:22px;margin-top:60px;text-align:center}
</style></head><body>
<header>🎧 <b>Swara</b> · Quarantine Review — trust your ear</header>
<div id="app"><div class="card"><div class="title">Loading…</div></div></div>
<script>
let queue=[], i=0, last=null;
const app=document.getElementById('app');

async function boot(){
  const r=await fetch('/list'); const j=await r.json();
  queue=j.queue; render();
}
function fmt(s){s=s|0;return (s/60|0)+':'+('0'+(s%60)).slice(-2);}

function render(){
  if(i>=queue.length){
    app.innerHTML='<div id="done">✅ All caught up — nothing left to review.<br>'
      +'<span style="color:#9aa4b2;font-size:15px">You can close this tab.</span></div>';
    refreshCounts(); return;
  }
  const s=queue[i];
  const tags=(s.had_lyrics?'<span class="tag">had romanized lyrics</span>':'')
           +(s.singers?'<span class="tag">'+s.singers.slice(0,40)+'</span>':'');
  app.innerHTML=`<div class="card">
    <div class="title">${esc(s.title)}</div>
    <div class="meta">${esc(s.movie)}${s.year?' · '+s.year:''}${s.duration?' · '+fmt(s.duration):''}</div>
    <div>${tags}</div>
    <audio id="au" src="/play?id=${encodeURIComponent(s.id)}" controls preload="auto"></audio>
    <div class="btns">
      <button class="v telugu"  onclick="verdict('telugu')"><span class="k">T</span> Telugu</button>
      <button class="v bgm"     onclick="verdict('bgm')"><span class="k">B</span> BGM / score</button>
      <button class="v foreign" onclick="verdict('foreign')"><span class="k">F</span> Foreign</button>
      <button class="v skip"    onclick="verdict('skip')"><span class="k">S</span> Skip</button>
    </div>
    <div style="text-align:center"><button id="undo" onclick="undo()">↶ Undo last (U)</button></div>
    <div class="row"><span>Reviewed <b>${i}</b></span><span>Left <b id="left">${queue.length-i}</b></span></div>
  </div>`;
  const au=document.getElementById('au');
  au.addEventListener('loadedmetadata',()=>{ if(au.duration&&isFinite(au.duration)) au.currentTime=au.duration*0.35; });
  au.play().catch(()=>{});   // autoplay after first interaction; ignored before
}
function esc(t){return (t+'').replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));}

async function verdict(v){
  const s=queue[i]; last={id:s.id,v:v};
  fetch('/verdict?id='+encodeURIComponent(s.id)+'&v='+v);   // fire-and-forget; DB write
  i++; render();
}
async function undo(){
  if(!last) return;
  await fetch('/undo?id='+encodeURIComponent(last.id));
  i=Math.max(0,i-1); last=null; render();
}
async function refreshCounts(){ /* counts shown on done screen if desired */ }

document.addEventListener('keydown',e=>{
  if(e.target.tagName==='INPUT')return;
  const k=e.key.toLowerCase();
  if(k==='t')verdict('telugu'); else if(k==='b')verdict('bgm');
  else if(k==='f')verdict('foreign'); else if(k==='s')verdict('skip');
  else if(k==='u')undo();
  else if(e.code==='Space'){e.preventDefault();const a=document.getElementById('au');if(a){a.paused?a.play():a.pause();}}
});
boot();
</script></body></html>"""


# ── server ───────────────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: bytes, ctype: str = "text/html; charset=utf-8") -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj: Any, code: int = 200) -> None:
        self._send(code, json.dumps(obj).encode("utf-8"), "application/json")

    def log_message(self, *args) -> None:  # silence per-request console spam
        pass

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        route = parsed.path
        qs = parse_qs(parsed.query)
        sid = (qs.get("id") or [""])[0]

        if route == "/":
            self._send(200, PAGE.encode("utf-8"))
        elif route == "/list":
            self._json({"queue": _queue(), "counts": _counts()})
        elif route == "/play":
            doc = get_quarantine_collection().find_one({"_id": sid}, {"encrypted_media_url": 1})
            url = resolve_stream(doc.get("encrypted_media_url")) if doc else None
            if not url:
                self._send(404, b"no audio")
                return
            self.send_response(302)
            self.send_header("Location", url)
            self.end_headers()
        elif route == "/verdict":
            v = (qs.get("v") or [""])[0]
            self._json({"ok": _apply(sid, v)})
        elif route == "/undo":
            self._json({"ok": _undo(sid)})
        else:
            self._send(404, b"not found")


def main() -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    c = _counts()
    print("Swara quarantine reviewer")
    print(f"  {c['remaining']} songs waiting  (already: {c['telugu']} Telugu, "
          f"{c['bgm']} BGM, {c['foreign']} foreign)")
    print(f"\n  Open  http://{HOST}:{PORT}  in your browser.")
    print("  Keys: T=Telugu  B=BGM  F=Foreign  S=Skip  U=Undo  Space=play/pause")
    print("  Ctrl+C here to stop the server (your progress is saved in the DB).\n")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
