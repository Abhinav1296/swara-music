/**
 * Local demo lyrics dataset (PLACEHOLDER / non-copyrighted text only).
 *
 * Keyed by track `id` (string) OR normalized title (lowercase, no punctuation).
 * Values are LRC strings (timed lines) or plain text. This is a scaffold:
 * populate it, or add a real provider behind `loadLyrics`, with an approved
 * source. Do NOT add scraped or copyrighted lyrics here.
 */
export const demoLyrics = {
  // Example keyed by track id:
  "725218144": `[00:00.00] (Demo) Swara lyrics scaffold
[00:04.00] These are placeholder timed lines
[00:08.00] Keyed by track id
[00:12.00] Tap a line to seek the preview
[00:16.00] Edit demoLyrics.js to add real entries`,

  // Example keyed by normalized title (see normalizeTitle):
  samajavaragamana: `[00:00.00] (Demo) Local demo lyrics
[00:05.00] Replace with real timed lyrics
[00:10.00] Keyed by normalized title
[00:15.00] Clearly marked as a demo scaffold`,

  rangamma: `[00:00.00] (Demo) Local demo lyrics
[00:06.00] Another sample entry
[00:12.00] Add your own timed LRC here`,
};
