// Sidebar follow-up (design gate, 2026-07-19): back/forward navigate the
// sequence of individually-opened ("View") History entries -- confirmed via
// Q&A, not a switch between the Queue/History/Preferences sections.
//
// `stack` is a plain list of entry ids in the order they were first opened;
// `pointer` is the current position in it; `isOpen` tracks whether the entry
// at `pointer` is currently expanded (a "Close" click clears this WITHOUT
// touching the stack, so back() can still reach it -- re-opening the same
// entry from a closed state does not push a duplicate). Opening a
// DIFFERENT entry than the one at `pointer` truncates anything ahead of it
// first, same as a browser tab's history after navigating away mid-stack.
import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";
import { useNav } from "../nav/NavContext";

interface HistoryNavContextValue {
  currentId: number | null;
  canGoBack: boolean;
  canGoForward: boolean;
  view: (id: number) => void;
  close: () => void;
  back: () => void;
  forward: () => void;
}

const HistoryNavContext = createContext<HistoryNavContextValue | null>(null);

export function HistoryNavProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<number[]>([]);
  const [pointer, setPointer] = useState(-1);
  const [isOpen, setIsOpen] = useState(false);
  const { setActiveTab } = useNav();

  const view = (id: number) => {
    if (isOpen && stack[pointer] === id) return;
    if (pointer >= 0 && stack[pointer] === id) {
      setIsOpen(true);
      return;
    }
    setStack((prev) => [...prev.slice(0, pointer + 1), id]);
    setPointer((prev) => prev + 1);
    setIsOpen(true);
  };

  const close = () => setIsOpen(false);

  const back = () => {
    if (pointer <= 0) return;
    setPointer((prev) => prev - 1);
    setIsOpen(true);
    setActiveTab("history");
  };

  const forward = () => {
    if (pointer >= stack.length - 1) return;
    setPointer((prev) => prev + 1);
    setIsOpen(true);
    setActiveTab("history");
  };

  const value: HistoryNavContextValue = {
    currentId: isOpen && pointer >= 0 ? stack[pointer] : null,
    canGoBack: pointer > 0,
    canGoForward: pointer < stack.length - 1,
    view,
    close,
    back,
    forward,
  };

  return <HistoryNavContext.Provider value={value}>{children}</HistoryNavContext.Provider>;
}

export function useHistoryNav(): HistoryNavContextValue {
  const ctx = useContext(HistoryNavContext);
  if (!ctx) {
    throw new Error("useHistoryNav must be used within a HistoryNavProvider");
  }
  return ctx;
}
