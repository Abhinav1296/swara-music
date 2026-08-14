import { useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { usePlayer } from "../context/PlayerContext";
import { runBackHandlers } from "../utils/backStack";

/**
 * Android hardware / gesture BACK handling for the native shell.
 *
 * Capacitor's default is to exit the app on BACK, which feels wrong inside a
 * multi-screen app. We intercept it and make BACK behave the way people expect:
 *
 *   1. full-screen player open  -> close it
 *   2. queue panel open         -> close it
 *   3. somewhere to go back to  -> in-app history back
 *   4. nothing left             -> exit the app
 *
 * The router keeps window.history in sync (pushState/popstate), so
 * window.history.back() drives in-app navigation. `canGoBack` comes from the
 * backButton event itself.
 *
 * No-op on web — the backButton event only fires on native, and we also gate
 * registration to Android so nothing runs in the browser preview.
 */
export function useAndroidBackButton() {
  const { fullscreen, queueOpen, closeFullscreen, closeQueue } = usePlayer();

  // The listener is registered once, so mirror the latest state/handlers into a
  // ref to avoid reading stale values from the closure.
  const stateRef = useRef(null);
  stateRef.current = { fullscreen, queueOpen, closeFullscreen, closeQueue };

  useEffect(() => {
    if (Capacitor.getPlatform() !== "android") return undefined;

    let handle;
    CapacitorApp.addListener("backButton", ({ canGoBack }) => {
      // Innermost overlays (lyrics/up-next sheet, versions picker) get first
      // dibs — they close before the player itself does.
      if (runBackHandlers()) return;
      const s = stateRef.current;
      if (s.fullscreen) {
        s.closeFullscreen();
      } else if (s.queueOpen) {
        s.closeQueue();
      } else if (canGoBack) {
        window.history.back();
      } else {
        CapacitorApp.exitApp();
      }
    }).then((h) => {
      handle = h;
    });

    return () => {
      if (handle) handle.remove();
    };
  }, []);
}
