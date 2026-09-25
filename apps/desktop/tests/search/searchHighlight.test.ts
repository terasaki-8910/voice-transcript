import { describe, it, expect } from "vitest";
import { highlightTerms, extractSnippet } from "../../src/features/search/searchHighlight";

describe("highlightTerms", () => {
  it("returns the whole text as one unmatched segment when there are no terms", () => {
    expect(highlightTerms("hello world", [])).toEqual([{ text: "hello world", matched: false }]);
  });

  it("marks a single matching term and round-trips the original text exactly", () => {
    const segments = highlightTerms("hello 2GOMCP world", ["2GOMCP"]);
    expect(segments).toEqual([
      { text: "hello ", matched: false },
      { text: "2GOMCP", matched: true },
      { text: " world", matched: false },
    ]);
    expect(segments.map((s) => s.text).join("")).toBe("hello 2GOMCP world");
  });

  it("matches case-insensitively, preserving the original casing in the output", () => {
    const segments = highlightTerms("Hello WORLD", ["world"]);
    expect(segments.find((s) => s.matched)?.text).toBe("WORLD");
  });

  it("highlights every occurrence and every distinct term", () => {
    const segments = highlightTerms("cat dog cat bird", ["cat", "bird"]);
    expect(segments.filter((s) => s.matched).map((s) => s.text)).toEqual(["cat", "cat", "bird"]);
  });

  it("prefers the longest term when one term is a substring of another", () => {
    const segments = highlightTerms("MacBook Pro", ["Mac", "MacBook"]);
    const matched = segments.filter((s) => s.matched).map((s) => s.text);
    expect(matched).toEqual(["MacBook"]);
  });

  it("ignores empty/whitespace-only terms", () => {
    expect(highlightTerms("hello", ["", "   "])).toEqual([{ text: "hello", matched: false }]);
  });

  it("treats regex special characters in a term as literal text", () => {
    const segments = highlightTerms("cost: $5 (approx)", ["$5"]);
    expect(segments.filter((s) => s.matched).map((s) => s.text)).toEqual(["$5"]);
  });
});

describe("extractSnippet", () => {
  it("returns null when no term matches inside the text", () => {
    expect(extractSnippet("hello world", ["xyz"])).toBeNull();
  });

  it("returns the whole text unchanged when it already fits within the context window", () => {
    expect(extractSnippet("short text with match", ["match"], 60)).toBe("short text with match");
  });

  it("truncates a long text to a window around the match, with an ellipsis only on cut edges", () => {
    const text = "a".repeat(100) + "MATCH" + "b".repeat(100);
    const snippet = extractSnippet(text, ["MATCH"], 10);
    expect(snippet).toBe("…" + "a".repeat(10) + "MATCH" + "b".repeat(10) + "…");
  });

  it("omits the ellipsis on an edge the window did not actually cut", () => {
    const text = "MATCH" + "b".repeat(100);
    const snippet = extractSnippet(text, ["MATCH"], 10);
    expect(snippet?.startsWith("…")).toBe(false);
    expect(snippet?.endsWith("…")).toBe(true);
  });
});
