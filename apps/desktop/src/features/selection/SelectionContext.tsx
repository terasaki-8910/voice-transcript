// F21 (native-menu). ACCEPTANCE G8's "Export" menu item needs some notion
// of "the current transcript" -- this tracks whichever row (Queue or
// History) was last expanded via "View", so Export always has something
// concrete to act on without a separate selection UI. `format` is
// currently always "txt": neither QueueRow's result nor HistoryRow's
// stored transcriptText carry a pre-rendered srt/vtt/json string (only the
// plain text), and the GUI doesn't expose format selection yet either (F17
// hardcodes "txt" for every queued transcription) -- re-rendering other
// formats client-side would mean importing packages/core's render()
// pipeline into the webview, reopening the Blob/DOM typecheck issue
// documented in lib/tauri.ts. Exporting plain text today is an honest
// scope match to what's actually available, not a shortcut around G8.
import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";

export interface Selection {
  fileName: string;
  text: string;
  format: string;
}

interface SelectionContextValue {
  selection: Selection | null;
  setSelection: (selection: Selection) => void;
}

const SelectionContext = createContext<SelectionContextValue | null>(null);

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<Selection | null>(null);
  return <SelectionContext.Provider value={{ selection, setSelection }}>{children}</SelectionContext.Provider>;
}

export function useSelection(): SelectionContextValue {
  const ctx = useContext(SelectionContext);
  if (!ctx) {
    throw new Error("useSelection must be used within a SelectionProvider");
  }
  return ctx;
}
