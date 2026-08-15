import { useEffect, useState } from "react";

/**
 * Reactive online/offline status from the browser's `navigator.onLine` plus the
 * window `online` / `offline` events. Works inside the Capacitor WebView too,
 * with no extra plugin (zero-dependency).
 *
 * Note the asymmetry: `onLine === false` reliably means "no connection", while
 * `true` only means "probably connected" (a captive portal can still fail). It's
 * the right signal for "should I bother showing network-only content?".
 */
export default function useOnlineStatus() {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine
  );

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    // Re-sync once in case connectivity changed between initial state and mount.
    setOnline(navigator.onLine);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  return online;
}
