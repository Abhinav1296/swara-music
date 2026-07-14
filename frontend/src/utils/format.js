/** Format a duration given in seconds as "m:ss" (used by the player). */
export function formatTime(totalSeconds) {
  if (!totalSeconds || Number.isNaN(totalSeconds)) return "0:00";
  const s = Math.floor(totalSeconds);
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
