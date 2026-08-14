// A LIFO stack of "back intent" handlers for the Android hardware/gesture BACK
// button (see hooks/useAndroidBackButton). Overlays that live in local
// component state — the mobile lyrics/up-next sheet, the versions picker — can't
// be seen by the central back handler, so each one registers a handler here
// while it's open and removes it when it closes. BACK runs the top-most handler
// first, so the most-recently-opened overlay closes first (mirrors how the UI
// stacks visually), and only falls through to closing the player / navigating
// once nothing on the stack consumes the press.
const stack = [];

/**
 * Register a back handler. Returns an unsubscribe fn (call it on unmount/close).
 * The handler should close its overlay and return true when it consumes the
 * back press; return false to let the next handler down the stack try.
 */
export function pushBackHandler(fn) {
  stack.push(fn);
  return () => {
    const i = stack.lastIndexOf(fn);
    if (i !== -1) stack.splice(i, 1);
  };
}

/**
 * Run handlers from the top down until one consumes the back press.
 * Returns true if some handler handled it, false if the stack was inert.
 */
export function runBackHandlers() {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i]()) return true;
  }
  return false;
}
