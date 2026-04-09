/**
 * STOP_PHRASES — D7 noise filter for the keyword suggestion engine.
 *
 * The D7 "Suggest keywords" chip row scans the document for capitalised
 * multi-word phrases (`Project Falcon`, `Zephyr Alpha`) that appear ≥5 times.
 * Without filtering, the suggestions get drowned in contract-skeleton noise:
 * `Section 4.1`, `Article III`, `제 1 조`, `Schedule A`. None of these are
 * sensitive — they appear that often because that's how contracts are
 * structured, not because they identify a party or a product.
 *
 * This module exports the curated list and a single predicate `isStopPhrase`
 * that the suggestion engine consults before promoting a candidate.
 *
 * Two surfaces:
 *  - `STOP_PHRASE_LITERALS` — exact-match strings (case-sensitive). Title
 *    Case is the standard contract form for these markers.
 *  - `STOP_PHRASE_PATTERNS` — anchored regexes for forms with variable
 *    spacing or numbering, like `제 ?\d+ ?조` (Korean clause numbering with
 *    optional spaces between 제, the number, and 조).
 *
 * `isStopPhrase(s)` returns true iff `s` is in the literal set OR matches
 * one of the patterns end-to-end. Substring matches do NOT trigger — only
 * a clean equality / full-string regex match counts. This avoids accidentally
 * filtering out a legitimate "Section 4 of the Master Agreement" -style
 * phrase that happens to contain a stop word.
 */

/**
 * English + Korean literal stop words. Case-sensitive on purpose: contracts
 * use Title Case for these markers and lowercased forms (like "section" in
 * the middle of a sentence) should not be treated as structural noise.
 */
export const STOP_PHRASE_LITERALS: ReadonlyArray<string> = [
  // English contract skeleton
  "Section",
  "Article",
  "Schedule",
  "Exhibit",
  "Annex",
  "Appendix",
  "Attachment",
  "Clause",
  "Recital",
  "Recitals",
  "Preamble",
  "Definitions",
  "Whereas",
  // Korean contract skeleton
  "별표",
  "부속서",
  "별첨",
  "첨부",
  "전문",
  "정의",
];

/**
 * Anchored regex stop-phrase patterns. Each must match the **entire** input
 * (using `^...$` anchors) so that `isStopPhrase` only fires for inputs that
 * are nothing but a structural marker.
 */
export const STOP_PHRASE_PATTERNS: ReadonlyArray<RegExp> = [
  // Korean clause numbering: 제 N 조 (with optional spaces).
  // Examples: "제1조", "제 1 조", "제 12 조".
  /^제 ?\d+ ?조$/,
  // Korean section / chapter numbering: 제 N 장 / 제 N 항.
  /^제 ?\d+ ?장$/,
  /^제 ?\d+ ?항$/,
  // Korean appendix numbering: 별표 N, 부속서 N.
  /^별표 ?\d+$/,
  /^부속서 ?\d+$/,
  // English roman / alpha numbered: "Section 1", "Article III", "Schedule A".
  /^(?:Section|Article|Schedule|Exhibit|Annex|Appendix|Clause) [0-9IVXLCDM]+(?:\.[0-9]+)*[A-Z]?$/,
];

/** Pre-built Set so the literal lookup is O(1). */
const LITERAL_SET = new Set(STOP_PHRASE_LITERALS);

/**
 * Return true iff `phrase` is *entirely* a stop phrase. Used by the keyword
 * suggestion engine (D7) to filter out structural contract markers before
 * surfacing the chip row to the user. Substring matches do not count.
 */
export function isStopPhrase(phrase: string): boolean {
  if (phrase.length === 0) return false;
  if (LITERAL_SET.has(phrase)) return true;
  for (const re of STOP_PHRASE_PATTERNS) {
    if (re.test(phrase)) return true;
  }
  return false;
}
