import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { googleLogin, fetchMe, updateProfile as apiUpdateProfile } from "../api/client";

/**
 * Auth state for the whole app.
 *
 * A login exchanges a Google ID token for our own signed session JWT (stored in
 * localStorage). On boot we re-hydrate the user from that token; an invalid /
 * expired token is cleared silently. `logout` also disables Google auto-select
 * so the next sign-in shows the account chooser ("switch accounts").
 */
const TOKEN_KEY = "swara:session_token";
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => {
    try {
      return localStorage.getItem(TOKEN_KEY) || null;
    } catch {
      return null;
    }
  });
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(token)); // hydrating a saved session
  const [error, setError] = useState(null);

  // Hydrate / validate whenever the token changes.
  useEffect(() => {
    if (!token) {
      setUser(null);
      setLoading(false);
      return undefined;
    }
    let active = true;
    setLoading(true);
    fetchMe(token)
      .then((d) => active && setUser(d.user))
      .catch(() => {
        if (!active) return;
        // Invalid / expired token → clear it.
        setUser(null);
        setToken(null);
        try {
          localStorage.removeItem(TOKEN_KEY);
        } catch {
          /* ignore */
        }
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [token]);

  const login = useCallback(async (idToken) => {
    setError(null);
    const d = await googleLogin(idToken);
    setUser(d.user);
    setToken(d.token);
    try {
      localStorage.setItem(TOKEN_KEY, d.token);
    } catch {
      /* ignore */
    }
    return d.user;
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    // So the next sign-in offers the account chooser instead of auto-selecting.
    try {
      window.google?.accounts?.id?.disableAutoSelect?.();
    } catch {
      /* ignore */
    }
  }, []);

  const updateProfile = useCallback(
    async (patch) => {
      if (!token) return null;
      const d = await apiUpdateProfile(token, patch);
      setUser(d.user);
      return d.user;
    },
    [token]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        error,
        isAuthed: Boolean(user),
        login,
        logout,
        updateProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
