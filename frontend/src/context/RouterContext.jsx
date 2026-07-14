import { createContext, useCallback, useContext, useEffect, useState } from "react";

/**
 * Minimal, dependency-free client-side router.
 *
 * Supports named routes with params and keeps the browser history in sync
 * (back/forward buttons work). Routes:
 *   home | search (q) | library | artist (id) | album (id) | playlist (id)
 *
 * On boot it parses the current URL so deep links / refreshes land on the
 * right view. This avoids pulling in a router library while still giving
 * deep links and history support for an SPA of this size.
 */
const RouterContext = createContext(null);

const KNOWN = new Set(["home", "search", "library", "artist", "album", "playlist"]);

function urlFor(name, params) {
  if (name === "home") return "/";
  if (name === "search" && params?.q) return `/search?q=${encodeURIComponent(params.q)}`;
  if (name === "playlist" && params?.id) {
    let u = `/playlist?id=${encodeURIComponent(params.id)}`;
    if (params.name) u += `&name=${encodeURIComponent(params.name)}`;
    return u;
  }
  // Artist / album pages are addressed by name (Lyrica/JioSaavn have no ids).
  if ((name === "artist" || name === "album") && params?.name) {
    let u = `/${name}?name=${encodeURIComponent(params.name)}`;
    if (name === "album" && params.artist)
      u += `&artist=${encodeURIComponent(params.artist)}`;
    return u;
  }
  return `/${name}`;
}

/** Parse window.location into a { name, params } route (deep-link boot). */
function routeFromLocation() {
  try {
    const path = window.location.pathname.replace(/^\/+/, "").split("/")[0] || "home";
    const name = KNOWN.has(path) ? path : "home";
    const qs = new URLSearchParams(window.location.search);
    const params = {};
    if (name === "search" && qs.get("q")) params.q = qs.get("q");
    if (name === "playlist" && qs.get("id")) {
      params.id = qs.get("id");
      if (qs.get("name")) params.name = qs.get("name");
    }
    if ((name === "artist" || name === "album") && qs.get("name")) {
      params.name = qs.get("name");
      if (name === "album" && qs.get("artist")) params.artist = qs.get("artist");
    }
    // A detail route without its required param is meaningless on cold boot.
    if (name === "playlist" && !params.id) return { name: "home", params: {} };
    if ((name === "artist" || name === "album") && !params.name)
      return { name: "home", params: {} };
    return { name, params };
  } catch {
    return { name: "home", params: {} };
  }
}

export function RouterProvider({ children }) {
  const [route, setRoute] = useState(() => routeFromLocation());

  // Seed history state so the first back/forward has something to restore to.
  useEffect(() => {
    const initial = routeFromLocation();
    window.history.replaceState(initial, "", urlFor(initial.name, initial.params));
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const navigate = useCallback((name, params = {}, opts = {}) => {
    const next = { name, params };
    setRoute(next);
    const url = urlFor(name, params);
    if (opts.replace) window.history.replaceState(next, "", url);
    else window.history.pushState(next, "", url);
  }, []);

  useEffect(() => {
    const onPop = (e) => {
      const state = e.state;
      if (state && state.name) setRoute({ name: state.name, params: state.params || {} });
      else setRoute(routeFromLocation());
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return (
    <RouterContext.Provider value={{ route, navigate }}>{children}</RouterContext.Provider>
  );
}

export function useRouter() {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error("useRouter must be used within a RouterProvider");
  return ctx;
}
