/**
 * D7 keyword suggestion engine — pure rule-based, zero ML.
 *
 * Surfaces "common keywords for this deal" chips to the user. The lawyer
 * has the final word: chips are visual hints, never auto-applied. The point
 * is to catch product / brand / code names the PII regex sweep can't see
 * (Lane A doesn't know `Project Falcon` from `Project Sunday Brunch`),
 * without giving up the "no AI" trust property.
 *
 * Five rules, all combined into one pass. A candidate becomes a chip iff:
 *
 *   1. **English Title Case** — `\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b`. Catches
 *      `Project Falcon`, `Zephyr Alpha`, `Blue Wing Two`. Frequency floor 5.
 *   2. **Project/brand prefix (multilingual)** — `(Project|프로젝트|브랜드|
 *      제품|코드명|모델(?:명)?)\s+(\S+)`. Catches `프로젝트 블루윙`,
 *      `Project Helios`, `브랜드 X`. Frequency floor 5.
 *   3. **Version-suffixed token** — `(\S+)\s+(?:\d+\.\d+|v\d+|alpha|beta|rc)\b`.
 *      Catches `블루윙 2.0`, `Falcon v3`, `Atlas alpha`. Frequency floor 5.
 *   4. **Quoted phrase** — `["'「『]([^"'」』]{2,30})["'」』]`. The inner
 *      phrase becomes a candidate iff it appears inside quotes ≥3 times.
 *      A separate threshold because quoted phrases are inherently rarer
 *      than free-form repetitions.
 *   5. **Frequency floor** — every candidate from rules 1-3 must be ≥2 chars
 *      AND occur ≥`minFrequency` times in the document. Filters noise.
 *
 * Exclusions (never become chips):
 *  - STOP_PHRASES (Section, Article, 별표, 제 ?\d+ ?조, ...)
 *  - The caller-provided exclude set (already-applied PII matches, user's
 *    manually entered keywords)
 *
 * Public API:
 *  - `suggestKeywords(text, opts?)` — returns the unique chip strings.
 *
 * The suggester is intentionally pure: no zip walk, no scope concept.
 * Callers run `extractTextFromZip` first, join the per-scope text, and
 * pass the joined string in. Keeping it pure makes it trivially testable
 * and reusable for future "paste raw text" entry paths.
 */

import { isStopPhrase } from "./stop-phrases.js";

/** Tuning knobs for the suggester. */
export interface SuggestKeywordsOptions {
  /**
   * Minimum number of occurrences for rules 1-3 to surface a candidate.
   * Defaults to 5 — high enough to filter noise, low enough that real
   * project names in a 30-page contract clear the bar.
   */
  readonly minFrequency?: number;
  /**
   * Minimum number of *quoted* occurrences for Rule 4. Defaults to 3
   * because quoted forms are inherently rarer than free-form mentions.
   */
  readonly quotedMinFrequency?: number;
  /**
   * Strings that should never be surfaced as suggestions. Caller-supplied
   * — typically the union of (already-applied PII matches) ∪ (user's
   * existing keyword list). Comparison is exact (case-sensitive).
   */
  readonly exclude?: Iterable<string>;
}

/** Rule 1: English Title Case bigram or longer. */
const TITLE_CASE_RE = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g;

/** Rule 2: prefix (Project / 프로젝트 / 브랜드 / 제품 / 코드명 / 모델) + one body word. */
const PREFIX_RE =
  /(?:Project|프로젝트|브랜드|제품|코드명|모델(?:명)?)\s+(\S+)/gi;

/** Rule 3: token followed by a version suffix (semver, v\d+, alpha/beta/rc). */
const VERSION_RE = /(\S+)\s+(?:\d+\.\d+|v\d+|alpha|beta|rc)\b/gi;

/** Rule 4: quoted phrase, 2-30 chars between matching quote characters. */
const QUOTED_RE = /["'「『]([^"'」』]{2,30})["'」』]/g;

/**
 * Run the five rules against `text` and return the deduped set of
 * suggestion strings, in insertion order.
 */
export function suggestKeywords(
  text: string,
  opts: SuggestKeywordsOptions = {},
): string[] {
  if (text.length === 0) return [];

  const minFreq = opts.minFrequency ?? 5;
  const quotedMin = opts.quotedMinFrequency ?? 3;
  const exclude = new Set<string>(opts.exclude ?? []);

  const out = new Set<string>();

  // ── Rules 1-3: full-match candidates, gated on the global frequency floor.
  // Each candidate is the *full* regex match (not a captured group), so
  // "Project Falcon" gets suggested whole — not just "Falcon" — and the
  // user's downstream redaction targets the literal phrase that appears
  // in the document.
  const ruleCandidates = new Set<string>();
  collectMatches(text, TITLE_CASE_RE, ruleCandidates);
  collectMatches(text, PREFIX_RE, ruleCandidates);
  collectMatches(text, VERSION_RE, ruleCandidates);

  for (const cand of ruleCandidates) {
    if (!passesFloor(cand, text, minFreq, exclude)) continue;
    out.add(cand);
  }

  // ── Rule 4: quoted phrases use the captured INNER text, not the full
  // match (quotes themselves are not part of the redaction target). The
  // counting is also different — we count quoted occurrences, not raw
  // substring occurrences, so a phrase that happens to appear in plain
  // text 100 times but is only quoted twice is not surfaced.
  const quotedCounts = new Map<string, number>();
  for (const m of text.matchAll(QUOTED_RE)) {
    const inner = m[1];
    if (inner === undefined) continue;
    quotedCounts.set(inner, (quotedCounts.get(inner) ?? 0) + 1);
  }
  for (const [inner, count] of quotedCounts) {
    if (count < quotedMin) continue;
    if (inner.length < 2) continue;
    if (exclude.has(inner)) continue;
    if (isStopPhrase(inner)) continue;
    out.add(inner);
  }

  return [...out];
}

/**
 * Push every full-match string from `re` into `acc`. Used by rules 1-3 to
 * collect candidate phrases without caring about capture groups.
 */
function collectMatches(text: string, re: RegExp, acc: Set<string>): void {
  // Clone the regex so the caller's `lastIndex` state doesn't bleed across
  // invocations. Cheap; safer than relying on the global flag's reset behavior.
  const fresh = new RegExp(re.source, re.flags);
  for (const m of text.matchAll(fresh)) {
    acc.add(m[0]);
  }
}

/**
 * Apply the universal candidate filter: length floor, exclusion list,
 * STOP_PHRASES, and the frequency floor. Returns true iff the candidate
 * survives all four checks.
 */
function passesFloor(
  candidate: string,
  text: string,
  minFreq: number,
  exclude: ReadonlySet<string>,
): boolean {
  if (candidate.length < 2) return false;
  if (exclude.has(candidate)) return false;
  if (isStopPhrase(candidate)) return false;
  if (countOccurrences(text, candidate) < minFreq) return false;
  return true;
}

/**
 * Count non-overlapping occurrences of `needle` in `haystack`. Plain
 * `indexOf` walk — same approach as `verify.ts` — because regex special
 * chars in user-suggested candidates would otherwise need escaping.
 */
function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) return count;
    count++;
    from = idx + needle.length;
  }
}
