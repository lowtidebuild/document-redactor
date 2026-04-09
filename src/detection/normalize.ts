/**
 * Unicode normalization layer (Eng review lock-in #3).
 *
 * Two faces:
 *
 *  1. `normalizeText(s)` — full normalization, used by **variant propagation**
 *     (Lane C) where the goal is to match `ＡＢＣ` against `ABC` or `김철수`
 *     in NFD form against the same string in NFC form. Loses positional info
 *     because NFC composition is N→1.
 *
 *  2. `normalizeForMatching(s)` — position-preserving subset, used by **PII
 *     detection** (Lane A). Applies every transformation EXCEPT NFC composition,
 *     so the output is 1:1 with the input at the codepoint level. Returns an
 *     `origOffsets` array so a regex match in normalized form can be sliced
 *     out of the *original* text and fed to the redactor verbatim.
 *
 * Why two? The redactor (Lane B) operates on the literal characters that live
 * in the DOCX XML. If detection finds a phone number `010\u20131234\u20135678`
 * (with en-dashes) by normalizing to `010-1234-5678`, but then hands the
 * ASCII-hyphen form to the redactor, the redactor scans the XML for ASCII
 * hyphens and misses the en-dash form — silent leak. So Lane A normalizes
 * for *matching* but returns the *original* substring as the redaction target.
 *
 * Transformations applied (both faces, except NFC):
 *
 * - **NFC composition** — `\u1100\u1161` → `가`. Korean text in DOCX may be
 *   either composed (one syllable codepoint) or decomposed (jamo trio). NFC
 *   only — never NFD — because the regex / variant propagation logic assumes
 *   composed Hangul. (`normalizeForMatching` skips this; see above.)
 * - **Fullwidth → halfwidth** — `\uFF21\uFF22\uFF23` → `ABC`, `\uFF10` → `0`,
 *   `\u3000` → ` `. Common in Asian docs; without this, `０１０` would not
 *   match the phone regex.
 * - **Smart quotes → straight** — `"" '' 「」 『』` all collapse to `" "` and
 *   `' '`. Required for the D7 quoted-phrase suggestion rule.
 * - **Zero-width strip** — `\u200B \u200C \u200D \uFEFF \u2060` deleted. Word
 *   inserts these at hyphenation points and Korean composition seams; without
 *   the strip, `A\u200BBC` would not match `ABC`.
 * - **Hyphen variants → ASCII hyphen** — `‐ ‑ ‒ – — ― −` and a few CJK forms.
 *   Without this, `010–1234–5678` (en-dash) would not match the phone regex.
 *
 * Both faces are pure functions. No DOM, no Intl, no fetch.
 */

/**
 * Smart quote characters that should fold to ASCII `"` or `'` for matching.
 * Mapped here as a record because the keys are easier to read than a switch.
 */
const SMART_QUOTE_MAP: Record<string, string> = {
  "\u201C": '"', // LEFT DOUBLE QUOTATION MARK "
  "\u201D": '"', // RIGHT DOUBLE QUOTATION MARK "
  "\u201E": '"', // DOUBLE LOW-9 QUOTATION MARK „
  "\u201F": '"', // DOUBLE HIGH-REVERSED-9 QUOTATION MARK ‟
  "\u2018": "'", // LEFT SINGLE QUOTATION MARK '
  "\u2019": "'", // RIGHT SINGLE QUOTATION MARK '
  "\u201A": "'", // SINGLE LOW-9 QUOTATION MARK ‚
  "\u201B": "'", // SINGLE HIGH-REVERSED-9 QUOTATION MARK ‛
  "\u00AB": '"', // LEFT-POINTING DOUBLE ANGLE QUOTATION MARK «
  "\u00BB": '"', // RIGHT-POINTING DOUBLE ANGLE QUOTATION MARK »
  "\u300C": '"', // LEFT CORNER BRACKET 「
  "\u300D": '"', // RIGHT CORNER BRACKET 」
  "\u300E": '"', // LEFT WHITE CORNER BRACKET 『
  "\u300F": '"', // RIGHT WHITE CORNER BRACKET 』
};

/**
 * Hyphen-like characters that should collapse to ASCII `-` for matching.
 * Includes the formal hyphens, en/em dashes, the minus sign, and the small /
 * fullwidth variants used in CJK documents.
 */
const HYPHEN_MAP: Record<string, string> = {
  "\u2010": "-", // HYPHEN
  "\u2011": "-", // NON-BREAKING HYPHEN
  "\u2012": "-", // FIGURE DASH
  "\u2013": "-", // EN DASH –
  "\u2014": "-", // EM DASH —
  "\u2015": "-", // HORIZONTAL BAR ―
  "\u2212": "-", // MINUS SIGN −
  "\uFE58": "-", // SMALL EM DASH ﹘
  "\uFE63": "-", // SMALL HYPHEN-MINUS ﹣
  "\uFF0D": "-", // FULLWIDTH HYPHEN-MINUS －
};

/** Zero-width characters that should be deleted entirely. */
const ZERO_WIDTH = new Set<number>([
  0x200B, // ZERO WIDTH SPACE
  0x200C, // ZERO WIDTH NON-JOINER
  0x200D, // ZERO WIDTH JOINER
  0xFEFF, // ZERO WIDTH NO-BREAK SPACE / BOM
  0x2060, // WORD JOINER
]);

/**
 * Apply every normalization layer (NFC + 1:1 substitutions). Used by variant
 * propagation, where we don't need to recover original positions.
 */
export function normalizeText(text: string): string {
  // NFC first so that Hangul jamo trios become single syllable codepoints,
  // then apply the substitution + strip layers on the now-canonical form.
  let out = text.normalize("NFC");
  out = applySubstitutions(out);
  return out;
}

/**
 * Result of `normalizeForMatching`: the normalized text plus an offset map
 * that lets callers recover the corresponding slice of the *original* text
 * for any normalized match.
 */
export interface PositionMap {
  /** Normalized text with all 1:1 substitutions applied and zero-width chars stripped. */
  readonly text: string;
  /**
   * For each utf16 unit i in `text`, the utf16 index in the original text
   * that produced it. Length is `text.length + 1`; the final entry is the
   * exclusive end sentinel (= original length), so callers can compute the
   * end of any slice as `origOffsets[matchEnd]`.
   */
  readonly origOffsets: ReadonlyArray<number>;
}

/**
 * Apply 1:1 normalizations (smart quotes, fullwidth→halfwidth, hyphen variants)
 * plus zero-width stripping, while recording the original index of every
 * surviving character. **NFC composition is intentionally not applied** here
 * because it is N→1 and would break the offset map; callers that need NFC
 * should use `normalizeText` and accept the loss of position info.
 */
export function normalizeForMatching(text: string): PositionMap {
  // Build the output codepoint by codepoint so we correctly handle:
  //  - surrogate pairs (count as one codepoint, two utf16 units)
  //  - 1:1 substitutions (smart quotes, hyphens, fullwidth)
  //  - deletions (zero-width chars are skipped without consuming an output slot)
  const outChars: string[] = [];
  const offsets: number[] = [];

  let i = 0;
  while (i < text.length) {
    const code = text.codePointAt(i)!;
    const charLen = code > 0xFFFF ? 2 : 1;

    if (ZERO_WIDTH.has(code)) {
      // Drop the codepoint entirely. No output slot, no offset entry.
      i += charLen;
      continue;
    }

    let mapped: string;
    if (code === 0x3000) {
      mapped = " ";
    } else if (code >= 0xFF01 && code <= 0xFF5E) {
      // Fullwidth ASCII range maps to U+0021..U+007E (offset 0xFEE0).
      mapped = String.fromCodePoint(code - 0xFEE0);
    } else {
      const ch = text.slice(i, i + charLen);
      mapped = SMART_QUOTE_MAP[ch] ?? HYPHEN_MAP[ch] ?? ch;
    }

    // Push one offset entry per output utf16 unit so the map is
    // `text.length + 1` long when we add the sentinel below. For surrogate
    // pairs that came in as 2 units and survived as 2 units, both units
    // share the same original starting index — slicing the original text
    // by `origOffsets[start]..origOffsets[end]` will recover the full pair.
    for (let k = 0; k < mapped.length; k++) {
      outChars.push(mapped[k]!);
      offsets.push(i);
    }

    i += charLen;
  }

  // Sentinel: callers compute the exclusive end of a slice as
  // `origOffsets[matchEnd]`, so we need an entry at index `text.length`.
  offsets.push(text.length);

  return { text: outChars.join(""), origOffsets: offsets };
}

/**
 * Apply the substitution + strip layers used by both faces. Pulled out so
 * `normalizeText` and tests don't duplicate the logic. Operates codepoint
 * by codepoint to handle surrogate pairs correctly.
 */
function applySubstitutions(text: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const code = text.codePointAt(i)!;
    const charLen = code > 0xFFFF ? 2 : 1;

    if (ZERO_WIDTH.has(code)) {
      i += charLen;
      continue;
    }
    if (code === 0x3000) {
      out.push(" ");
    } else if (code >= 0xFF01 && code <= 0xFF5E) {
      out.push(String.fromCodePoint(code - 0xFEE0));
    } else {
      const ch = text.slice(i, i + charLen);
      out.push(SMART_QUOTE_MAP[ch] ?? HYPHEN_MAP[ch] ?? ch);
    }
    i += charLen;
  }
  return out.join("");
}
