/**
 * Legal "listen to the full song" bridge.
 *
 * We now stream full JioSaavn tracks in-app (resolved through Lyrica — see
 * PlayerContext). These URLs open external services in a new tab so users can
 * hear the track on the source services — no in-app scraping.
 *
 * All three are search URLs built from `trackName` + `artistName`, so they work
 * for any track without needing an external catalog id.
 */
export function buildExternalLinks(song) {
  const query = `${song?.trackName || ""} ${song?.artistName || ""}`.trim();
  const q = encodeURIComponent(query);
  return {
    youtube: `https://www.youtube.com/results?search_query=${q}`,
    spotify: `https://open.spotify.com/search/${q}`,
    apple: `https://music.apple.com/us/search?term=${q}`,
  };
}

/** Human-friendly labels, kept in one place for menus / buttons. */
export const EXTERNAL_LINKS = [
  { key: "youtube", label: "YouTube" },
  { key: "spotify", label: "Spotify" },
  { key: "apple", label: "Apple Music" },
];
