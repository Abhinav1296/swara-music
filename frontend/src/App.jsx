import { useCallback } from "react";
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
    <div className="flex h-full w-screen overflow-hidden text-white">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onSearch={handleSearch} />
        <main className="flex-1 overflow-y-auto px-4 pb-[calc(11rem_+_env(safe-area-inset-bottom))] pt-2 md:px-6 md:pb-40">{content}</main>
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
      <LibraryProvider>
        <PlaylistProvider>
          <RouterProvider>
            <PlayerProvider>
              <Shell />
            </PlayerProvider>
          </RouterProvider>
        </PlaylistProvider>
      </LibraryProvider>
    </AuthProvider>
  );
}