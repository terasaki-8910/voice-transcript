// Search (SPEC.md > Search). A modal (not the sidebar's own always-there
// "文字起こしを検索" box, which stays exactly as it is) reachable from a
// dedicated icon next to the sidebar collapse toggle -- deliberately
// separate because that inline box only filters the page of history
// already loaded client-side (at most listHistory()'s own limit) by title
// and body alone. This modal instead queries the whole table through the
// sidecar (searchHistory: title + transcript body + note text, all three,
// with older history included), so it earns its own, more deliberate entry
// point rather than replacing the always-visible quick filter.
import { useEffect, useState } from "react";
import type { ReactNode, KeyboardEvent as ReactKeyboardEvent } from "react";
import { FiSearch } from "react-icons/fi";
import { useI18n } from "../../i18n/I18nContext";
import { useNav } from "../nav/NavContext";
import { useHistoryNav } from "../history/HistoryNavContext";
import { useHistorySearch } from "./useHistorySearch";
import { highlightTerms, extractSnippet } from "./searchHighlight";
import type { HighlightSegment } from "./searchHighlight";
import type { HistorySearchResult } from "../../lib/tauri";
import { basename } from "../../lib/path";
import "./search.css";

function renderHighlighted(segments: HighlightSegment[]): ReactNode[] {
  return segments.map((s, i) =>
    s.matched ? (
      <mark key={i} className="search-highlight">
        {s.text}
      </mark>
    ) : (
      <span key={i}>{s.text}</span>
    ),
  );
}

function SearchResultRow({
  result,
  terms,
  focused,
  onClick,
}: {
  result: HistorySearchResult;
  terms: string[];
  focused: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  // A custom title (set via History's rename pencil) takes over here too --
  // renaming is searchable by design (db/history.ts's searchHistory ORs
  // title in alongside sourceFileName/transcriptText/notes), so showing the
  // raw filename instead of the name that was actually searched by would
  // read as inconsistent.
  const fileName = result.title ?? basename(result.sourceFileName);
  const snippet = result.transcriptText ? extractSnippet(result.transcriptText, terms) : null;
  const firstNote = result.matchedNotes[0];

  return (
    <div
      className={`search-result-row${focused ? " is-focused" : ""}`}
      role="option"
      aria-selected={focused}
      onClick={onClick}
    >
      <div className="search-result-top">
        <span className="search-result-title">{renderHighlighted(highlightTerms(fileName, terms))}</span>
        <span className="search-result-meta">{result.startedAt.toLocaleString()}</span>
      </div>
      {snippet && <p className="search-result-snippet">{renderHighlighted(highlightTerms(snippet, terms))}</p>}
      {!snippet && firstNote && (
        <p className="search-result-snippet">
          "{renderHighlighted(highlightTerms(firstNote.quotedText, terms))}"
          {" → "}
          {renderHighlighted(highlightTerms(firstNote.note, terms))}
          {result.matchedNotes.length > 1 && ` (${t("searchMoreNotes").replace("{count}", String(result.matchedNotes.length - 1))})`}
        </p>
      )}
    </div>
  );
}

export function SearchModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { setActiveTab } = useNav();
  const { view } = useHistoryNav();
  const { query, setQuery, terms, results, loading, error } = useHistorySearch();
  const [focusedIndex, setFocusedIndex] = useState(0);

  useEffect(() => {
    setFocusedIndex(0);
  }, [results]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const openResult = (id: number) => {
    setActiveTab("history");
    view(id);
    onClose();
  };

  const handleInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[focusedIndex]) {
      openResult(results[focusedIndex].id);
    }
  };

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t("searchModalTitle")}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal search-modal">
        <div className="search-modal-header">
          <FiSearch aria-hidden="true" />
          <input
            autoFocus
            type="text"
            aria-label={t("searchModalTitle")}
            placeholder={t("searchModalPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
          />
          <button type="button" className="btn-link" onClick={onClose}>
            {t("close")}
          </button>
        </div>
        <p className="settings-hint">{t("searchModalHint")}</p>

        <div className="search-modal-results" role="listbox" aria-label={t("searchModalTitle")}>
          {terms.length === 0 && <p className="modal-status">{t("searchModalEmptyHint")}</p>}
          {terms.length > 0 && loading && <p className="modal-status">{t("searchModalLoading")}</p>}
          {terms.length > 0 && !loading && !error && results.length === 0 && (
            <p className="modal-status">{t("historyNoResults")}</p>
          )}
          {error && <p className="fail-reason">{error}</p>}
          {results.map((r, i) => (
            <SearchResultRow
              key={r.id}
              result={r}
              terms={terms}
              focused={i === focusedIndex}
              onClick={() => openResult(r.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
