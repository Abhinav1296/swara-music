import { useRouter } from "../context/RouterContext";
import DetailView from "./DetailView";

/** Album detail page — reads the name (and optional artist) from the router. */
export default function AlbumView() {
  const { route } = useRouter();
  return (
    <DetailView
      name={route.params.name}
      artist={route.params.artist}
      kind="album"
    />
  );
}
