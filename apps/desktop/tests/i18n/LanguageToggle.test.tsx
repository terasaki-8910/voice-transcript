// F19: pins I18nProvider/useI18n/LanguageToggle in src/i18n/**, and
// ACCEPTANCE G6 -- switching the language setting updates ALL visible UI
// text immediately, without a restart. Exercises that against a second,
// unrelated consumer (ThemeToggle) to prove it's not just the toggle's own
// labels that change.
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { I18nProvider } from "../../src/i18n/I18nContext";
import { LanguageToggle } from "../../src/i18n/LanguageToggle";
import { ThemeProvider } from "../../src/theme/ThemeContext";
import { ThemeToggle } from "../../src/theme/ThemeToggle";

function renderApp() {
  return render(
    <I18nProvider>
      <ThemeProvider>
        <LanguageToggle />
        <ThemeToggle />
      </ThemeProvider>
    </I18nProvider>,
  );
}

describe("LanguageToggle", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.lang = "";
  });

  it("defaults to English and marks the EN tab selected", () => {
    renderApp();
    expect(document.documentElement.lang).toBe("en");
    expect(screen.getByRole("button", { name: "EN" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: "Light" })).toBeDefined();
  });

  it("switching to 日本語 updates document.lang and re-renders every consumer's copy immediately", () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: "日本語" }));

    expect(document.documentElement.lang).toBe("ja");
    // The unrelated ThemeToggle's own labels switched too -- not just
    // LanguageToggle's own button text -- with no unmount/remount involved.
    expect(screen.getByRole("button", { name: "ライト" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Light" })).toBeNull();
  });

  it("persists the language choice across a remount", () => {
    const { unmount } = renderApp();
    fireEvent.click(screen.getByRole("button", { name: "日本語" }));
    unmount();

    renderApp();
    expect(document.documentElement.lang).toBe("ja");
    expect(screen.getByRole("button", { name: "日本語" }).getAttribute("aria-selected")).toBe("true");
  });
});
