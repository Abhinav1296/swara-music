// Headless simulation of the goNext queue-advancing race.
// Mirrors the EXACT logic in PlayerContext.jsx (sequential branch).
// Goal: prove that, across 3 rapid skips fired BEFORE any re-render,
// the OLD logic (transportRef refreshed only on render) picks the same
// track repeatedly, while the NEW logic (transportRef synced synchronously)
// advances correctly.

function makePlayer({ syncTransportRef }) {
  // committed React state
  let current = "C0";
  let upcoming = ["C1", "C2", "C3", "C4"];
  let played = [];
  // transportRef mirrors the latest queue; refreshed on render.
  let transportRef = { current, upcoming, played };

  const goNext = () => {
    const snap = transportRef; // fresh mirror read
    if (snap.upcoming.length === 0) return null;
    const [next, ...rest] = snap.upcoming;
    current = next;
    upcoming = rest;
    played = [...snap.played, snap.current];
    // React setState would schedule a re-render that refreshes transportRef.
    // In the OLD code, that refresh does NOT happen synchronously.
    if (syncTransportRef) {
      // NEW: refresh transportRef immediately, before the next call.
      transportRef = { current, upcoming, played };
    }
    return next;
  };

  // Simulate a re-render committing state to transportRef (as React does).
  const render = () => {
    transportRef = { current, upcoming, played };
  };

  return { goNext, render };
}

function runRapidSkips(label, sync) {
  const p = makePlayer({ syncTransportRef: sync });
  const picked = [];
  // 3 rapid nexts fired back-to-back with NO render() in between.
  for (let i = 0; i < 3; i++) {
    picked.push(p.goNext());
    if (sync) p.render(); // NEW model commits synchronously per call
  }
  console.log(`${label}: rapid-skip picks = [${picked.join(", ")}]`);
}

console.log("=== Swara goNext race simulation ===");
runRapidSkips("OLD (transportRef only on render)", false);
runRapidSkips("NEW (transportRef synced synchronously)", true);
