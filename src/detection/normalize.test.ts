import { describe, it, expect } from "vitest";

import { normalizeText, normalizeForMatching } from "./normalize.js";

describe("normalizeText (full normalization for variant matching)", () => {
  it("returns ASCII text unchanged", () => {
    expect(normalizeText("ABC Corporation")).toBe("ABC Corporation");
  });

  it("composes Korean NFD jamo into NFC syllables", () => {
    // U+1100 (ㄱ) + U+1161 (ㅏ) → U+AC00 (가)
    expect(normalizeText("\u1100\u1161")).toBe("\uAC00");
    // Decomposed 김 (U+1100 + U+1175 + U+11B7) → composed 김 (U+AE40)
    expect(normalizeText("\u1100\u1175\u11B7")).toBe("\uAE40");
  });

  it("converts fullwidth ASCII to halfwidth", () => {
    expect(normalizeText("\uFF21\uFF22\uFF23")).toBe("ABC");
    expect(normalizeText("\uFF10\uFF11\uFF12")).toBe("012");
    // Fullwidth space U+3000 → ASCII space
    expect(normalizeText("\uFF21\u3000\uFF22")).toBe("A B");
  });

  it("converts smart quotes to straight quotes", () => {
    expect(normalizeText("\u201CABC\u201D")).toBe('"ABC"');
    expect(normalizeText("\u2018ABC\u2019")).toBe("'ABC'");
    // Korean corner brackets 「」『』 → straight double quotes
    expect(normalizeText("\u300CABC\u300D")).toBe('"ABC"');
    expect(normalizeText("\u300EABC\u300F")).toBe('"ABC"');
  });

  it("strips zero-width characters", () => {
    expect(normalizeText("A\u200BB\u200CC\u200DD\uFEFFE")).toBe("ABCDE");
    expect(normalizeText("A\u2060B")).toBe("AB");
  });

  it("collapses hyphen variants to ASCII hyphen", () => {
    // ‐ ‑ ‒ – — ― and minus sign all → -
    expect(normalizeText("010\u20131234\u20135678")).toBe("010-1234-5678");
    expect(normalizeText("010\u22121234")).toBe("010-1234");
    expect(normalizeText("010\u20141234")).toBe("010-1234");
    expect(normalizeText("010\u20151234")).toBe("010-1234");
  });

  it("applies all normalizations together", () => {
    const input = "\uFF21\uFF22\uFF23\u200B\u2013\uFF11\uFF12\uFF13";
    // ABC + ZWSP-stripped + en-dash → -, then 123
    expect(normalizeText(input)).toBe("ABC-123");
  });

  it("is idempotent", () => {
    const input = "ABC \"hello\" 010-1234-5678 김철수";
    const once = normalizeText(input);
    const twice = normalizeText(once);
    expect(once).toBe(twice);
  });

  it("preserves unrelated CJK characters", () => {
    // 한자 should not be touched
    expect(normalizeText("甲乙丙丁")).toBe("甲乙丙丁");
  });
});

describe("normalizeForMatching (position-preserving subset)", () => {
  it("returns text and origOffsets", () => {
    const result = normalizeForMatching("ABC");
    expect(result.text).toBe("ABC");
    // origOffsets has length text.length + 1 (sentinel at end)
    expect(result.origOffsets).toHaveLength(4);
    expect(result.origOffsets[0]).toBe(0);
    expect(result.origOffsets[1]).toBe(1);
    expect(result.origOffsets[2]).toBe(2);
    expect(result.origOffsets[3]).toBe(3);
  });

  it("does NOT apply NFC composition (1:1 only)", () => {
    // NFC would compose this, but normalizeForMatching keeps it as-is
    const input = "\u1100\u1161";
    const result = normalizeForMatching(input);
    expect(result.text).toBe("\u1100\u1161");
    expect(result.text).not.toBe("\uAC00");
  });

  it("maps fullwidth digits 1:1", () => {
    const input = "\uFF10\uFF11\uFF12-\uFF13\uFF14\uFF15";
    const result = normalizeForMatching(input);
    expect(result.text).toBe("012-345");
    // Each output char came from the corresponding input char
    expect(result.origOffsets).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("strips zero-width and adjusts offsets", () => {
    // "A\u200BBC" → "ABC" with origOffsets [0, 2, 3, 4]
    const result = normalizeForMatching("A\u200BBC");
    expect(result.text).toBe("ABC");
    // Norm[0]=A is at orig 0; Norm[1]=B is at orig 2 (skipped ZWSP at 1)
    expect(result.origOffsets[0]).toBe(0);
    expect(result.origOffsets[1]).toBe(2);
    expect(result.origOffsets[2]).toBe(3);
    expect(result.origOffsets[3]).toBe(4); // sentinel
  });

  it("collapses unicode hyphens 1:1", () => {
    const input = "010\u20131234\u20135678";
    const result = normalizeForMatching(input);
    expect(result.text).toBe("010-1234-5678");
    // No length change, every offset is identity
    expect(result.origOffsets).toHaveLength(input.length + 1);
  });

  it("collapses smart quotes 1:1", () => {
    const result = normalizeForMatching("\u201Chello\u201D");
    expect(result.text).toBe('"hello"');
  });

  it("supports recovering original substring from normalized match", () => {
    const orig = "phone: 010\u20131234\u20135678 end";
    const result = normalizeForMatching(orig);
    // Match "010-1234-5678" in normalized form
    const idx = result.text.indexOf("010-1234-5678");
    expect(idx).toBeGreaterThanOrEqual(0);
    const end = idx + "010-1234-5678".length;
    const origStart = result.origOffsets[idx]!;
    const origEnd = result.origOffsets[end]!;
    expect(orig.slice(origStart, origEnd)).toBe("010\u20131234\u20135678");
  });

  it("supports recovering original across stripped zero-width", () => {
    const orig = "A\u200BB\u200BC";
    const result = normalizeForMatching(orig);
    expect(result.text).toBe("ABC");
    // Match "ABC" → original is "A\u200BB\u200BC" (the full stretch)
    const origStart = result.origOffsets[0]!;
    const origEnd = result.origOffsets[3]!;
    expect(orig.slice(origStart, origEnd)).toBe("A\u200BB\u200BC");
  });

  it("handles empty string", () => {
    const result = normalizeForMatching("");
    expect(result.text).toBe("");
    expect(result.origOffsets).toEqual([0]);
  });

  it("preserves CJK ideographs as-is", () => {
    const result = normalizeForMatching("甲乙");
    expect(result.text).toBe("甲乙");
    expect(result.origOffsets).toEqual([0, 1, 2]);
  });

  it("preserves emoji surrogate pairs as 2-unit characters", () => {
    // 📼 is U+1F4FC, encoded as surrogate pair (2 utf16 units)
    const orig = "A\uD83D\uDCFCB";
    const result = normalizeForMatching(orig);
    // Output: A, surrogate pair (kept as 2 units), B → length 4
    expect(result.text).toBe("A\uD83D\uDCFCB");
    expect(result.text.length).toBe(4);
    // origOffsets has length 5 (4 + sentinel)
    expect(result.origOffsets).toHaveLength(5);
  });
});
