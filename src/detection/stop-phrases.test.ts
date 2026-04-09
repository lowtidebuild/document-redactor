import { describe, it, expect } from "vitest";

import {
  STOP_PHRASE_LITERALS,
  STOP_PHRASE_PATTERNS,
  isStopPhrase,
} from "./stop-phrases.js";

describe("STOP_PHRASE_LITERALS", () => {
  it("contains common English contract section markers", () => {
    expect(STOP_PHRASE_LITERALS).toContain("Section");
    expect(STOP_PHRASE_LITERALS).toContain("Article");
    expect(STOP_PHRASE_LITERALS).toContain("Schedule");
    expect(STOP_PHRASE_LITERALS).toContain("Exhibit");
    expect(STOP_PHRASE_LITERALS).toContain("Annex");
  });

  it("contains common Korean contract section markers", () => {
    expect(STOP_PHRASE_LITERALS).toContain("별표");
    expect(STOP_PHRASE_LITERALS).toContain("부속서");
  });
});

describe("STOP_PHRASE_PATTERNS", () => {
  it("matches the Korean clause numbering form 제 N 조", () => {
    const re = STOP_PHRASE_PATTERNS.find((p) => p.test("제 1 조"));
    expect(re).toBeDefined();
  });

  it("matches the no-space variant 제1조", () => {
    const re = STOP_PHRASE_PATTERNS.find((p) => p.test("제1조"));
    expect(re).toBeDefined();
  });
});

describe("isStopPhrase", () => {
  it("returns true for English literals", () => {
    expect(isStopPhrase("Section")).toBe(true);
    expect(isStopPhrase("Article")).toBe(true);
    expect(isStopPhrase("Schedule")).toBe(true);
  });

  it("returns true for Korean literals", () => {
    expect(isStopPhrase("별표")).toBe(true);
    expect(isStopPhrase("부속서")).toBe(true);
  });

  it("returns true when the WHOLE input matches a pattern", () => {
    expect(isStopPhrase("제 1 조")).toBe(true);
    expect(isStopPhrase("제2조")).toBe(true);
    expect(isStopPhrase("제 12 조")).toBe(true);
  });

  it("returns false for partial matches", () => {
    // "Section A" contains "Section" but is not equal to it
    expect(isStopPhrase("Section A")).toBe(false);
    // "ABC Article" contains "Article" but is not equal
    expect(isStopPhrase("ABC Article")).toBe(false);
  });

  it("returns false for normal company names", () => {
    expect(isStopPhrase("ABC Corporation")).toBe(false);
    expect(isStopPhrase("Sunrise Ventures")).toBe(false);
    expect(isStopPhrase("Project Falcon")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isStopPhrase("")).toBe(false);
  });

  it("is case-sensitive for English literals (Section ≠ section)", () => {
    // Contracts use Title Case for these markers; lowercased forms are
    // unlikely to be section headers and should not be filtered out.
    expect(isStopPhrase("section")).toBe(false);
  });
});
