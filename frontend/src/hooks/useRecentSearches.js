import { useEffect, useState } from "react";
import { loadJSON, saveJSON, STORAGE_KEYS } from "../utils/storage";

/** Persisted, capped list of recent search terms. */
export function useRecentSearches(limit = 10) {
  const [items, setItems] = useState(() => loadJSON(STORAGE_KEYS.recentSearches, []));

  useEffect(() => {
    saveJSON(STORAGE_KEYS.recentSearches, items);
  }, [items]);

  const add = (raw) => {
    const term = (raw || "").trim();
    if (!term) return;
    setItems((prev) => [term, ...prev.filter((t) => t !== term)].slice(0, limit));
  };

  const remove = (term) => setItems((prev) => prev.filter((t) => t !== term));
  const clear = () => setItems([]);

  return { items, add, remove, clear };
}
