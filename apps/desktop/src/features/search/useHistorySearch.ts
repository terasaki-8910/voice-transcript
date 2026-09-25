// Search (SPEC.md > Search). Debounced query state + results -- each
// keystroke does NOT fire its own search: the sidecar has no persistent
// connection, so every call spawns a fresh Node subprocess (see
// commands.rs's call_sidecar), and searching on every keystroke would spawn
// one per character typed. 250ms of no typing before a search actually
// fires is the standard debounce idiom (a pending setTimeout, cleared and
// replaced by the next render's effect cleanup).
import { useEffect, useState } from "react";
import { searchHistory } from "../../lib/tauri";
import type { HistorySearchResult } from "../../lib/tauri";

const DEBOUNCE_MS = 250;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface UseHistorySearch {
  query: string;
  setQuery: (query: string) => void;
  terms: string[];
  results: HistorySearchResult[];
  loading: boolean;
  error?: string;
}

export function useHistorySearch(): UseHistorySearch {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<HistorySearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const terms = query.split(/\s+/).filter((t) => t.length > 0);

  useEffect(() => {
    if (terms.length === 0) {
      setResults([]);
      setLoading(false);
      setError(undefined);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      searchHistory(query)
        .then((r) => {
          setResults(r);
          setError(undefined);
        })
        .catch((err: unknown) => setError(errorMessage(err)))
        .finally(() => setLoading(false));
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // Deliberately depends on `query` alone, not `terms`: terms is a new
    // array every render (derived fresh from query above), so depending on
    // it would re-fire this effect -- and reset the debounce timer -- on
    // every render, not just when the query text actually changes.
  }, [query]);

  return { query, setQuery, terms, results, loading, error };
}
