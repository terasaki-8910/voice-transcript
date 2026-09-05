// General display preference for the Preferences modal, localStorage-backed
// like theme -- not a secret, so it does not need to round-trip through the
// Tauri backend.
import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

const STORAGE_KEY = "voice-transcript-break-at-period";

interface DisplayPreferencesContextValue {
  breakAtPeriod: boolean;
  setBreakAtPeriod: (value: boolean) => void;
}

const DisplayPreferencesContext = createContext<DisplayPreferencesContextValue | null>(null);

function readStoredBreakAtPeriod(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) === "true";
}

export function DisplayPreferencesProvider({ children }: { children: ReactNode }) {
  const [breakAtPeriod, setBreakAtPeriodState] = useState<boolean>(() => readStoredBreakAtPeriod());

  const setBreakAtPeriod = (next: boolean) => {
    setBreakAtPeriodState(next);
    window.localStorage.setItem(STORAGE_KEY, next ? "true" : "false");
  };

  const value = useMemo(() => ({ breakAtPeriod, setBreakAtPeriod }), [breakAtPeriod]);

  return <DisplayPreferencesContext.Provider value={value}>{children}</DisplayPreferencesContext.Provider>;
}

export function useDisplayPreferences(): DisplayPreferencesContextValue {
  const ctx = useContext(DisplayPreferencesContext);
  if (!ctx) {
    throw new Error("useDisplayPreferences must be used within a DisplayPreferencesProvider");
  }
  return ctx;
}
