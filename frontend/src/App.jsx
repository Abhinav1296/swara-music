import { useCallback, useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { AuthProvider } from "./context/AuthContext";
import { LibraryProvider } from "./context/LibraryContext";
import { PlaylistProvider } from "./context/PlaylistContext";
import { RouterProvider, useRouter } from "./context/RouterContext";
import { PlayerProvider } from "./context/PlayerContext";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import MobileNav from "./components/MobileNav";
import NowPlayingBar from "./components/NowPlayingBar";
import FullScreenPlayer from "./components/FullScreenPlayer";
import QueuePanel from "./components/QueuePanel";
import HomeView from "./components/HomeView";
import SearchView from "./components/SearchView";
import LibraryView from "./components/LibraryView";
import PlaylistView from "./components/PlaylistView";
import ArtistView from "./components/ArtistView";
import AlbumView from "./components/AlbumView";
import AlbumsView from "./components/AlbumsView";
import ProfileView from "./components/ProfileView";
import SplashScreen from "./components/SplashScreen";

const SPLASH_KEY = "swara:splash_shown";

function Shell() {
  const { route, navigate } = useRouter();

  const handleSearch = useCallback(
    (q) => {
      const term = (q || "").trim();
      if (!term) return;
      navigate("search", { q: term }, { replace: route.name === "search" });
    },
    [navigate, route.name]
  );

  let content;
  switch (route.name) {
    case "search":
      content = <SearchView query={route.params.q || ""} />;
      break;
    case "library":
      content = <LibraryView />;
      break;
    case "playlist":
      content = <PlaylistView />;
      break;
    case "artist":
      content = <ArtistView />;
      break;
    case "album":
      content = <AlbumView />;
      break;
    case "albums":
      content = <AlbumsView />;
      break;
    case "profile":
      content = <ProfileView />;
      break;
    default:
      content = <HomeView />;
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden text-white">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onSearch={handleSearch} />
        <main className="flex-1 overflow-y-auto px-4 pb-44 pt-2 md:px-6 md:pb-40">{content}</main>
      </div>
      <NowPlayingBar />
      <FullScreenPlayer />
      <QueuePanel />
      <MobileNav />
    </div>
  );
}

export default function App() {
  // Splash: shown once per browser session (sessionStorage, not localStorage —
  // so it plays on cold open but not on route nav or in-tab reload).
  const [showSplash, setShowSplash] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return sessionStorage.getItem(SPLASH_KEY) !== "true";
    } catch {
      return false;
    }
  });

  // Safety net: if splash logic ever hangs, auto-hide after 4s so app is never blocked.
  useEffect(() => {
    if (!showSplash) return undefined;
    const kill = setTimeout(() => {
      try { sessionStorage.setItem(SPLASH_KEY, "true"); } catch {}
      setShowSplash(false);
    }, 4000);
    return () => clearTimeout(kill);
  }, [showSplash]);

  const handleSplashDone = useCallback(() => {
    try { sessionStorage.setItem(SPLASH_KEY, "true"); } catch {}
    setShowSplash(false);
  }, []);

  return (
    <AuthProvider>
      <LibraryProvider>
        <PlaylistProvider>
          <RouterProvider>
            <PlayerProvider>
              <Shell />
              <AnimatePresence>
                {showSplash && <SplashScreen key="splash" onComplete={handleSplashDone} />}
              </AnimatePresence>
            </PlayerProvider>
          </RouterProvider>
        </PlaylistProvider>
      </LibraryProvider>
    </AuthProvider>
  );
}