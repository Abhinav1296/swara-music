import { useEffect, useRef, useState } from "react";
import { loadGoogleIdentity, GOOGLE_CLIENT_ID } from "../auth/googleSignIn";

/**
 * Renders Google's official Sign-In button (web/dev). Calls `onCredential` with
 * the returned ID token, which AuthContext exchanges for a Swara session. On the
 * APK a native Capacitor plugin will replace this, feeding the same login path.
 */
export default function GoogleSignInButton({ onCredential, onError }) {
  const ref = useRef(null);
  const [msg, setMsg] = useState(
    GOOGLE_CLIENT_ID ? null : "Google Sign-In isn’t configured (missing client id)."
  );

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return undefined;
    let cancelled = false;
    loadGoogleIdentity()
      .then((google) => {
        if (cancelled || !ref.current) return;
        google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (resp) => resp?.credential && onCredential?.(resp.credential),
          auto_select: false,
        });
        google.accounts.id.renderButton(ref.current, {
          theme: "filled_black",
          size: "large",
          shape: "pill",
          text: "continue_with",
          width: 260,
        });
      })
      .catch((e) => {
        if (cancelled) return;
        setMsg("Couldn’t load Google Sign-In. Check your connection.");
        onError?.(e.message);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (msg) return <p className="text-xs text-white/40">{msg}</p>;
  return <div ref={ref} className="flex min-h-[44px] justify-center" />;
}
