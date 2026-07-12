// F20: pins ThemeProvider/useTheme/ThemeToggle in src/theme/**.
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider } from "../../src/theme/ThemeContext";
import { ThemeToggle } from "../../src/theme/ThemeToggle";

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
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
