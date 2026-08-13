// Google Identity Services (web) loader.
//
// On the web/dev build we render Google's official Sign-In button via GIS, which
// hands back an ID token. On the Capacitor APK a NATIVE Google Sign-In plugin
// will replace this, but both feed the same ID token into AuthContext.login().

export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

let _promise = null;

/** Load the GIS script once; resolves with `window.google`. */
export function loadGoogleIdentity() {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  if (_promise) return _promise;
  _promise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = () => resolve(window.google);
    s.onerror = () => {
      _promise = null;
      reject(new Error("Failed to load Google Sign-In"));
    };
    document.head.appendChild(s);
  });
  return _promise;
}
