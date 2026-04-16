import { describe, expect, it } from "vitest";

import { normalizeForMatching } from "../normalize.js";

import { recoverOriginalSlice } from "./recover-bytes.js";

describe("recoverOriginalSlice", () => {
  it("preserves smart quotes from the original text", () => {
    const original = `prefix \u201CAcme Corp\u201D suffix`;
    const map = normalizeForMatching(original);
    const start = map.text.indexOf(`"Acme Corp"`);
    const end = start + `"Acme Corp"`.length;
    expect(recoverOriginalSlice(original, map, start, end)).toBe(
      `\u201CAcme Corp\u201D`,
    );
  });

  it("preserves fullwidth digits from the original text", () => {
    const original = "Call \uFF10\uFF11\uFF12\uFF13 now";
    const map = normalizeForMatching(original);
    const start = map.text.indexOf("0123");
    const end = start + "0123".length;
    expect(recoverOriginalSlice(original, map, start, end)).toBe(
      "\uFF10\uFF11\uFF12\uFF13",
    );
  });

  it("passes ASCII slices through unchanged", () => {
    const original = "Acme Corp";
    const map = normalizeForMatching(original);
    expect(recoverOriginalSlice(original, map, 0, map.text.length)).toBe(
      "Acme Corp",
    );
  });

  it("supports startNorm = 0", () => {
    const original = "\uFF21BC";
    const map = normalizeForMatching(original);
    expect(recoverOriginalSlice(original, map, 0, 1)).toBe("\uFF21");
  });

  it("supports endNorm = text.length", () => {
    const original = `\u201CAcme\u201D`;
    const map = normalizeForMatching(original);
    expect(
      recoverOriginalSlice(original, map, 0, map.text.length),
    ).toBe(`\u201CAcme\u201D`);
  });

  it("returns an empty string for an empty slice", () => {
    const original = "Acme";
    const map = normalizeForMatching(original);
    expect(recoverOriginalSlice(original, map, 2, 2)).toBe("");
  });
});
