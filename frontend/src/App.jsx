import { useCallback } from "react";
import { AuthProvider } from "./context/AuthContext";
import { AuthGateProvider } from "./context/AuthGate";
import { LibraryProvider } from "./context/LibraryContext";
import { PlaylistProvider } from "./context/PlaylistContext";
import { RouterProvider, useRouter } from "./context/RouterContext";
import { OfflineProvider } from "./context/OfflineContext";
import { LocalSongsProvider } from "./context/LocalSongsContext";
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
import { useAndroidBackButton } from "./hooks/useAndroidBackButton";

function Shell() {
  const { route, navigate } = useRouter();

  // Android BACK closes overlays / navigates in-app instead of exiting (no-op on web).
  useAndroidBackButton();

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
    <div className="flex h-full w-screen overflow-hidden text-white">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Global search lives only on the Search tab now. On every other tab
            the bar is gone, so give the content the top safe-area inset the bar
            used to provide (keeps it clear of the status bar / notch). */}
        {route.name === "search" && <TopBar onSearch={handleSearch} />}
        <main
          className={`flex-1 overflow-y-auto px-4 pb-[calc(11rem_+_env(safe-area-inset-bottom))] md:px-6 md:pb-40 ${
            route.name === "search"
              ? "pt-2"
              : "pt-[calc(0.5rem_+_env(safe-area-inset-top))]"
          }`}
        >
          {content}
        </main>
      </div>
      <NowPlayingBar />
      <FullScreenPlayer />
      <QueuePanel />
      <MobileNav />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AuthGateProvider>
        <LibraryProvider>
          <PlaylistProvider>
            <RouterProvider>
              <OfflineProvider>
                <LocalSongsProvider>
                  <PlayerProvider>
                    <Shell />
                  </PlayerProvider>
                </LocalSongsProvider>
              </OfflineProvider>
            </RouterProvider>
          </PlaylistProvider>
        </LibraryProvider>
      </AuthGateProvider>
    </AuthProvider>
  );
}