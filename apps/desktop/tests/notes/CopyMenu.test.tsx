// Transcript notes (SPEC.md > Transcript notes > Copy). Pins CopyMenu's two
// shapes -- a single instant-copy icon with no notes, a 2-item menu once
// there are some -- and that the "copied" checkmark only flashes after the
// copy actually succeeds (2026-09-25 fix: it used to fire-and-forget,
// which could flash success on a failed clipboard write).
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CopyMenu } from "../../src/features/notes/CopyMenu";

function renderMenu(props: Partial<React.ComponentProps<typeof CopyMenu>> = {}) {
  const onCopy = vi.fn(async () => {});
  const onCopyWithNotes = vi.fn(async () => {});
  const utils = render(
    <CopyMenu
      hasNotes={false}
      onCopy={onCopy}
      onCopyWithNotes={onCopyWithNotes}
      copyLabel="Copy transcript"
      copyWithNotesLabel="Copy with notes"
      copiedLabel="Copied"
      {...props}
    />,
  );
  return { ...utils, onCopy, onCopyWithNotes };
}

describe("CopyMenu", () => {
  it("with no notes, renders a single icon button with no menu", () => {
    renderMenu({ hasNotes: false });
    expect(screen.getByRole("button", { name: "Copy transcript" })).toBeDefined();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("with no notes, clicking copies and flashes 'Copied'", async () => {
    const { onCopy } = renderMenu({ hasNotes: false });
    fireEvent.click(screen.getByRole("button", { name: "Copy transcript" }));
    expect(onCopy).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeDefined());
  });

  it("with no notes, a failed copy never shows 'Copied'", async () => {
    const onCopy = vi.fn(async () => {
      throw new Error("clipboard denied");
    });
    renderMenu({ hasNotes: false, onCopy });
    fireEvent.click(screen.getByRole("button", { name: "Copy transcript" }));
    await waitFor(() => expect(onCopy).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
    expect(screen.getByRole("button", { name: "Copy transcript" })).toBeDefined();
  });

  it("with notes, clicking the trigger opens a 2-item menu instead of copying immediately", () => {
    const { onCopy, onCopyWithNotes } = renderMenu({ hasNotes: true });
    fireEvent.click(screen.getByRole("button", { name: "Copy transcript" }));
    expect(screen.getByRole("menu")).toBeDefined();
    expect(screen.getByRole("menuitem", { name: "Copy transcript" })).toBeDefined();
    expect(screen.getByRole("menuitem", { name: "Copy with notes" })).toBeDefined();
    expect(onCopy).not.toHaveBeenCalled();
    expect(onCopyWithNotes).not.toHaveBeenCalled();
  });

  it("with notes, choosing 'Copy transcript' from the menu calls onCopy, closes the menu, and flashes Copied", async () => {
    const { onCopy } = renderMenu({ hasNotes: true });
    fireEvent.click(screen.getByRole("button", { name: "Copy transcript" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy transcript" }));
    expect(onCopy).toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeDefined());
  });

  it("with notes, choosing 'Copy with notes' from the menu calls onCopyWithNotes, not onCopy", async () => {
    const { onCopy, onCopyWithNotes } = renderMenu({ hasNotes: true });
    fireEvent.click(screen.getByRole("button", { name: "Copy transcript" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy with notes" }));
    expect(onCopyWithNotes).toHaveBeenCalled();
    expect(onCopy).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeDefined());
  });

  it("a failed 'Copy with notes' never flashes Copied", async () => {
    const onCopyWithNotes = vi.fn(async () => {
      throw new Error("clipboard denied");
    });
    renderMenu({ hasNotes: true, onCopyWithNotes });
    fireEvent.click(screen.getByRole("button", { name: "Copy transcript" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy with notes" }));
    await waitFor(() => expect(onCopyWithNotes).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
  });

  it("clicking outside the open menu closes it without copying", () => {
    const { onCopy, onCopyWithNotes } = renderMenu({ hasNotes: true });
    fireEvent.click(screen.getByRole("button", { name: "Copy transcript" }));
    expect(screen.getByRole("menu")).toBeDefined();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onCopy).not.toHaveBeenCalled();
    expect(onCopyWithNotes).not.toHaveBeenCalled();
  });

  it("Escape closes the open menu", () => {
    renderMenu({ hasNotes: true });
    fireEvent.click(screen.getByRole("button", { name: "Copy transcript" }));
    expect(screen.getByRole("menu")).toBeDefined();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
