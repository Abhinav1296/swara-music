import { useCallback } from "react";
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

function Shell() {
  const { route, navigate } = useRouter();

  // Live + submit search. Replace history while already on the search route
  // so typing doesn't spam the back button.
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
  return (
    <LibraryProvider>
      <PlaylistProvider>
        <RouterProvider>
          <PlayerProvider>
            <Shell />
          </PlayerProvider>
        </RouterProvider>
      </PlaylistProvider>
    </LibraryProvider>
  );
}
