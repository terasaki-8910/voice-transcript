// F21 (native-menu). activeTab moves from QueueView's local useState up
// here so the native menu's "Open history" item (useMenuEvents.ts) can
// switch tabs from outside the component tree, not just from a click
// inside QueueView's own toolbar.
import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";

export type Tab = "queue" | "history";

interface NavContextValue {
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
}

const NavContext = createContext<NavContextValue | null>(null);

export function NavProvider({ children }: { children: ReactNode }) {
  const [activeTab, setActiveTab] = useState<Tab>("queue");
  return <NavContext.Provider value={{ activeTab, setActiveTab }}>{children}</NavContext.Provider>;
}

export function useNav(): NavContextValue {
  const ctx = useContext(NavContext);
  if (!ctx) {
    throw new Error("useNav must be used within a NavProvider");
  }
  return ctx;
}
