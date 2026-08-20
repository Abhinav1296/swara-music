import useCachedArt from "../hooks/useCachedArt";

/**
 * A drop-in replacement for <img> that serves cover art from the device cache
 * when it's been saved (so covers render with no connection), and otherwise
 * shows the remote URL while quietly priming the cache for next time.
 *
 * Every other prop (className, alt, loading, onError, …) forwards straight to
 * the underlying <img>. On the web build the whole cache layer no-ops, so this
 * is just a plain <img> with the original src.
 */
export default function CachedImage({ src, ...rest }) {
  const resolved = useCachedArt(src);
  return <img src={resolved} {...rest} />;
}
