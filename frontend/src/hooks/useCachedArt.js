import { useEffect, useState } from "react";
import { cachedSrcFor, primeArt } from "../offline/imageCache";

/**
 * Resolve a cover URL to the best src available — the cached local file when
 * we've saved it, else the remote URL — and prime the device cache in the
 * background so a later offline launch already has it. No-ops off native
 * (returns the URL unchanged). Use this for animated covers (motion.img) and
 * CSS backgrounds where the <CachedImage> component doesn't fit; plain <img>
 * should use <CachedImage> instead.
 */
export default function useCachedArt(url) {
  const [resolved, setResolved] = useState(() => cachedSrcFor(url));

  useEffect(() => {
    setResolved(cachedSrcFor(url));
    if (!url) return undefined;
    let active = true;
    primeArt(url).then((localSrc) => {
      if (active && localSrc) setResolved(localSrc);
    });
    return () => {
      active = false;
    };
  }, [url]);

  return resolved;
}
