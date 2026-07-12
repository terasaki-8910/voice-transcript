// Smoke test: proves the Tauri + React + token-styled + provider wiring
// actually renders, not just typechecks. App.tsx grows incrementally across
// F17/F19/F20 (PLAN.md Wave 9); this only pins the toolbar's brand text and
// that the app renders under its real providers (mirroring main.tsx).
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "../src/App";
import { ThemeProvider } from "../src/theme/ThemeContext";
import { I18nProvider } from "../src/i18n/I18nContext";

describe("App", () => {
  it("renders the brand text in the toolbar", () => {
    render(
      <I18nProvider>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </I18nProvider>,
    );
    expect(screen.getByText("Voice Transcript")).toBeDefined();
  });
});
