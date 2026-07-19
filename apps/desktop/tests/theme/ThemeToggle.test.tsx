// F20: pins ThemeProvider/useTheme/ThemeToggle in src/theme/**. ThemeToggle
// also reads its label through the shared i18n system (F19), so it needs
// an I18nProvider ancestor too.
//
// Sidebar follow-up (2026-07-19): ThemeToggle is now a single icon button
// (was a Light/Dark ".tabs" pair) -- assertions moved from per-option
// aria-selected to the single button's aria-label and which icon is present.
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider } from "../../src/theme/ThemeContext";
import { ThemeToggle } from "../../src/theme/ThemeToggle";
import { I18nProvider } from "../../src/i18n/I18nContext";

function renderToggle() {
  return render(
    <I18nProvider>
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    </I18nProvider>,
  );
}

describe("ThemeToggle", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("defaults to light", () => {
    renderToggle();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(screen.getByRole("button", { name: "Toggle theme" })).toBeDefined();
  });

  it("clicking switches to dark and persists across a remount", () => {
    const { unmount } = renderToggle();
    fireEvent.click(screen.getByRole("button", { name: "Toggle theme" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    unmount();
    renderToggle();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("clicking again toggles back to light", () => {
    renderToggle();
    const button = screen.getByRole("button", { name: "Toggle theme" });
    fireEvent.click(button);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    fireEvent.click(button);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});
