// Settings > Custom dictionary. Word-replacement rules applied to every
// transcript (packages/core/src/dictionary.ts's applyDictionary(), wired in
// at packages/core/src/sidecar.ts's handleTranscribe and packages/cli/src/
// cli.ts's main). This component only does CRUD + import over the list --
// the actual replacement logic lives entirely server-side (sidecar), never
// duplicated here.
import { useEffect, useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { FiEdit2, FiTrash2, FiPlus, FiCheck } from "react-icons/fi";
import { useI18n } from "../../i18n/I18nContext";
import {
  listDictionary,
  addDictionaryEntry,
  updateDictionaryEntry,
  deleteDictionaryEntry,
  importDictionaryFile,
} from "../../lib/tauri";
import type { DictionaryEntryRecord } from "../../lib/tauri";

type Status = "loading" | "ready" | "error";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function DictionarySection() {
  const { t } = useI18n();
  const [entries, setEntries] = useState<DictionaryEntryRecord[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string>();

  const [newWord, setNewWord] = useState("");
  const [newReplacement, setNewReplacement] = useState("");
  const [addError, setAddError] = useState<string>();
  // Both flash a checkmark for 1500ms then revert -- same pattern as
  // CopyMenu's "Copied" (user-reported, 2026-09-29: adding a word gave no
  // feedback beyond the new row silently appearing at the top of a list
  // that can be long enough to scroll it out of view). justSavedId is
  // cleared via a functional update (not a bare setState(null)) so an
  // earlier row's timeout firing after a later row was saved can't clear
  // the wrong row's checkmark.
  const [added, setAdded] = useState(false);
  const [justSavedId, setJustSavedId] = useState<number | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editWord, setEditWord] = useState("");
  const [editReplacement, setEditReplacement] = useState("");
  const [editError, setEditError] = useState<string>();

  const [rowErrors, setRowErrors] = useState<Map<number, string>>(new Map());
  const [importMessage, setImportMessage] = useState<string>();
  const [importError, setImportError] = useState<string>();

  const refresh = () => {
    setStatus((prev) => (prev === "ready" ? prev : "loading"));
    listDictionary()
      .then((rows) => {
        setEntries(rows);
        setStatus("ready");
        setError(undefined);
      })
      .catch((err: unknown) => {
        setError(errorMessage(err));
        setStatus("error");
      });
  };

  useEffect(refresh, []);

  const handleAdd = async () => {
    setAddError(undefined);
    try {
      const entry = await addDictionaryEntry(newWord.trim(), newReplacement.trim());
      setEntries((prev) => [entry, ...prev]);
      setNewWord("");
      setNewReplacement("");
      setAdded(true);
      setTimeout(() => setAdded(false), 1500);
    } catch (err) {
      setAddError(errorMessage(err));
    }
  };

  const startEdit = (entry: DictionaryEntryRecord) => {
    setEditingId(entry.id);
    setEditWord(entry.word);
    setEditReplacement(entry.replacement);
    setEditError(undefined);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditError(undefined);
  };

  const handleSaveEdit = async (id: number) => {
    setEditError(undefined);
    try {
      const updated = await updateDictionaryEntry(id, editWord.trim(), editReplacement.trim());
      setEntries((prev) => prev.map((e) => (e.id === id ? updated : e)));
      setEditingId(null);
      setJustSavedId(id);
      setTimeout(() => setJustSavedId((current) => (current === id ? null : current)), 1500);
    } catch (err) {
      setEditError(errorMessage(err));
    }
  };

  const handleDelete = async (entry: DictionaryEntryRecord) => {
    try {
      const confirmed = await confirm(`${entry.word} -> ${entry.replacement}\n\n${t("dictionaryConfirmDeleteBody")}`, {
        title: t("dictionaryDeleteAria"),
        kind: "warning",
      });
      if (!confirmed) return;
      await deleteDictionaryEntry(entry.id);
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    } catch (err) {
      setRowErrors((prev) => new Map(prev).set(entry.id, errorMessage(err)));
    }
  };

  const handleImport = async () => {
    setImportMessage(undefined);
    setImportError(undefined);
    try {
      // The native file dialog is driven entirely inside the Rust command
      // (see lib/tauri.ts's comment) -- this call alone both prompts the
      // user to pick a file and imports it; null means they cancelled.
      const result = await importDictionaryFile();
      if (!result) return;
      refresh();
      setImportMessage(`+${result.inserted} / ~${result.updated}${result.skipped ? ` / -${result.skipped}` : ""}`);
    } catch (err) {
      setImportError(errorMessage(err));
    }
  };

  return (
    <div className="settings-section">
      <p className="settings-hint">{t("dictionaryDescription")}</p>

      <div className="dictionary-add-row">
        <input
          type="text"
          aria-label={t("dictionaryWordLabel")}
          placeholder={t("dictionaryWordLabel")}
          value={newWord}
          onChange={(e) => setNewWord(e.target.value)}
        />
        <span aria-hidden="true">→</span>
        <input
          type="text"
          aria-label={t("dictionaryReplacementLabel")}
          placeholder={t("dictionaryReplacementLabel")}
          value={newReplacement}
          onChange={(e) => setNewReplacement(e.target.value)}
        />
        <button
          type="button"
          className="icon-btn"
          aria-label={added ? t("added") : t("dictionaryAddWord")}
          title={added ? t("added") : t("dictionaryAddWord")}
          disabled={!newWord.trim() || !newReplacement.trim()}
          onClick={() => void handleAdd()}
        >
          {added ? <FiCheck aria-hidden="true" /> : <FiPlus aria-hidden="true" />}
        </button>
      </div>
      {addError && <p className="fail-reason">{addError}</p>}

      <div className="dictionary-toolbar">
        <button type="button" className="btn-link" onClick={() => void handleImport()}>
          {t("dictionaryImport")}
        </button>
        {importMessage && <span className="settings-hint">{importMessage}</span>}
      </div>
      {importError && <p className="fail-reason">{importError}</p>}

      {status === "loading" && <p className="modal-status">{t("dictionaryLoading")}</p>}
      {status === "error" && error && <p className="fail-reason">{error}</p>}
      {status === "ready" && entries.length === 0 && <p className="modal-status">{t("dictionaryEmpty")}</p>}

      <ul className="dictionary-list">
        {entries.map((entry) => (
          <li key={entry.id} className="dictionary-row">
            {editingId === entry.id ? (
              <>
                <input
                  type="text"
                  aria-label={t("dictionaryWordLabel")}
                  value={editWord}
                  onChange={(e) => setEditWord(e.target.value)}
                />
                <span aria-hidden="true">→</span>
                <input
                  type="text"
                  aria-label={t("dictionaryReplacementLabel")}
                  value={editReplacement}
                  onChange={(e) => setEditReplacement(e.target.value)}
                />
                <button type="button" className="btn-link" onClick={() => void handleSaveEdit(entry.id)}>
                  {t("save")}
                </button>
                <button type="button" className="btn-link" onClick={cancelEdit}>
                  {t("cancel")}
                </button>
              </>
            ) : (
              <>
                <span className="dictionary-word">{entry.word}</span>
                <span aria-hidden="true">→</span>
                <span className="dictionary-replacement">{entry.replacement}</span>
                {justSavedId === entry.id && <FiCheck aria-hidden="true" className="dictionary-saved-check" />}
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={t("dictionaryEditAria")}
                  title={t("dictionaryEditAria")}
                  onClick={() => startEdit(entry)}
                >
                  <FiEdit2 aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-btn icon-btn-danger"
                  aria-label={t("dictionaryDeleteAria")}
                  title={t("dictionaryDeleteAria")}
                  onClick={() => void handleDelete(entry)}
                >
                  <FiTrash2 aria-hidden="true" />
                </button>
              </>
            )}
            {editingId === entry.id && editError && <p className="fail-reason">{editError}</p>}
            {rowErrors.get(entry.id) && <p className="fail-reason">{rowErrors.get(entry.id)}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
