import { useRouter } from "../context/RouterContext";
import DetailView from "./DetailView";

/** Artist detail page — reads the name from the router and renders DetailView. */
export default function ArtistView() {
  const { route } = useRouter();
  return <DetailView name={route.params.name} kind="artist" />;
}
