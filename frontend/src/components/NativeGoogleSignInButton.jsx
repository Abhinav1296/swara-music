import { useState } from "react";
import { Loader2 } from "lucide-react";
import { nativeGoogleSignIn } from "../auth/nativeGoogleSignIn";

/**
 * Google Sign-In button for the native APK. Mirrors the look of the web GIS
 * button (black pill, colored G, "Continue with Google") but triggers the
 * native Credential Manager flow and hands the resulting ID token to
 * `onCredential` — the same login path the web button uses.
 */
export default function NativeGoogleSignInButton({ onCredential, onError }) {
  const [busy, setBusy] = useState(false);

  const handle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const idToken = await nativeGoogleSignIn();
      await onCredential?.(idToken);
    } catch (e) {
      const msg = String(e?.message || e || "");
      // Swallow user-cancelled dismissals; surface only real failures.
      if (!/cancel|dismiss|closed/i.test(msg)) {
        onError?.(msg || "Google Sign-In failed. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handle}
      disabled={busy}
      style={{ width: 260 }}
      className="flex h-11 items-center justify-center gap-3 rounded-full bg-black text-sm font-medium text-white shadow transition active:scale-[0.98] disabled:opacity-70"
    >
      {busy ? (
        <Loader2 size={18} className="animate-spin" />
      ) : (
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
          <path
            fill="#EA4335"
            d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
          />
          <path
            fill="#4285F4"
            d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
          />
          <path
            fill="#FBBC05"
            d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
          />
          <path
            fill="#34A853"
            d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
          />
        </svg>
      )}
      Continue with Google
    </button>
  );
}
