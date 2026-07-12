// F20: pins ThemeProvider/useTheme/ThemeToggle in src/theme/**. ThemeToggle
// also reads its labels through the shared i18n system (F19), so it needs
// an I18nProvider ancestor too.
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

  it("defaults to light and marks the Light tab selected", () => {
    renderToggle();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(screen.getByRole("button", { name: "Light" }).getAttribute("aria-selected")).toBe("true");
  });

  it("switching to Dark updates data-theme and persists across a remount", () => {
    const { unmount } = renderToggle();
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    unmount();
    renderToggle();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(screen.getByRole("button", { name: "Dark" }).getAttribute("aria-selected")).toBe("true");
  });
});
