// Smoke test for the F14 scaffold: proves the Tauri + React + token-styled
// wiring actually renders, not just typechecks.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "../src/App";

describe("App (scaffold)", () => {
  it("renders the brand heading", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Voice Transcript" })).toBeDefined();
  });
});
