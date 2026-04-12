import { describe, expect, it } from "vitest";

import { luhnCheck } from "./luhn.js";

describe("luhnCheck", () => {
  it("returns true for the canonical Visa test number", () => {
    expect(luhnCheck("4111111111111111")).toBe(true);
  });

  it("returns true for Visa with spaces", () => {
    expect(luhnCheck("4111 1111 1111 1111")).toBe(true);
  });

  it("returns true for Visa with hyphens", () => {
    expect(luhnCheck("4111-1111-1111-1111")).toBe(true);
  });

  it("returns true for the canonical Mastercard test number", () => {
    expect(luhnCheck("5555555555554444")).toBe(true);
  });

  it("returns false for a 16-digit non-Luhn-valid blob", () => {
    expect(luhnCheck("1234567890123456")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(luhnCheck("")).toBe(false);
  });

  it("returns false for non-digit input", () => {
    expect(luhnCheck("abcd-efgh-ijkl-mnop")).toBe(false);
  });

  it("ignores whitespace and punctuation between digits", () => {
    expect(luhnCheck("4111 - 1111 - 1111 - 1111")).toBe(true);
  });
});
