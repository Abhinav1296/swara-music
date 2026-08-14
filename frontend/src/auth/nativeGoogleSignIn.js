// Native Google Sign-In for the Capacitor APK.
//
// Google blocks its OAuth flow inside a plain WebView, so on the Android app we
// can't use the GIS web button. Instead we call the native Credential Manager
// via @capgo/capacitor-social-login, which returns an ID token — the SAME kind
// of token the GIS button produces on the web. Both feed AuthContext.login().
//
// The audience of the returned ID token is our Google *Web* client id
// (passed here as webClientId), which is exactly what the backend verifies —
// so no backend change is needed. The Android OAuth client (package +
// signing SHA-1) is what authorizes the app at Google's side; it is never
// referenced in code, only registered in the Google Cloud Console.

import { Capacitor } from "@capacitor/core";
import { GOOGLE_CLIENT_ID } from "./googleSignIn";

/** True only inside the native Android/iOS shell (false on web/dev). */
export function isNativePlatform() {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

let _initPromise = null;

// Initialize the plugin once per app session. Dynamically imported so the
// native plugin code never lands in the web bundle (web never calls this).
async function ensureInit() {
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    const { SocialLogin } = await import("@capgo/capacitor-social-login");
    await SocialLogin.initialize({
      google: {
        // Must be the *Web* client id so the ID token's audience matches the
        // backend's GOOGLE_CLIENT_ID check.
        webClientId: GOOGLE_CLIENT_ID,
        mode: "online", // returns the ID token + profile (not just an auth code)
      },
    });
    return SocialLogin;
  })().catch((e) => {
    // Let a failed init retry on the next attempt.
    _initPromise = null;
    throw e;
  });
  return _initPromise;
}

/**
 * Trigger the native Google account picker and return a Google ID token.
 * Throws if the user cancels or no token comes back.
 */
export async function nativeGoogleSignIn() {
  const SocialLogin = await ensureInit();
  const res = await SocialLogin.login({ provider: "google", options: {} });
  const idToken = res?.result?.idToken;
  if (!idToken) throw new Error("Google didn’t return an ID token.");
  return idToken;
}
