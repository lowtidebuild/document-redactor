/**
 * PII detection — Lane A's top-level entry point.
 *
 * Wires the normalization layer, the regex registry, and the scope walker
 * into a single producer that turns a loaded DOCX zip into a deduplicated
 * list of literal strings the Lane B redactor can scrub.
 *
 * Three public surfaces, layered:
 *
 *   1. `detectPii(text)` — pure function, takes plain text, returns matches.
 *      Works on a single paragraph or a whole scope's text. Always recovers
 *      the *original* substring (so the redactor matches the literal bytes
 *      in the XML), even when normalization fired.
 *
 *   2. `detectPiiInZip(zip)` — async, walks every text-bearing scope via
 *      `extractTextFromZip`, runs `detectPii` on each, attaches the source
 *      scope to every match. Used by the audit log and the per-scope leak
 *      report.
 *
 *   3. `buildTargetsFromZip(zip)` — async, returns a deduped, sorted array
 *      of plain strings ready to feed into `redactDocx({ targets })`.
 *
 * The split is deliberate: detection (regex) and rewriting (Lane B) talk
 * to each other through a list of strings, nothing else. There is no shared
 * state, no offsets, no scope pointers crossing the boundary. That makes
 * each lane independently testable and lets Lane C (variant propagation)
 * swap in or augment the target list later without touching either side.
 */

import type JSZip from "jszip";

import { extractTextFromZip } from "./extract-text.js";
import { normalizeForMatching } from "./normalize.js";
import { PII_KINDS, PII_PATTERNS, type PiiKind } from "./patterns.js";
import { luhnCheck } from "./rules/luhn.js";
import type { Scope } from "../docx/types.js";

/**
 * One PII match. The `original` field is what the redactor needs (literal
 * bytes from the input text). `normalized` is preserved alongside so audit
 * logs and the keyword suggester can compare against the canonical form.
 */
export interface DetectedMatch {
  /** Which pattern fired. */
  readonly kind: PiiKind;
  /** The matched string in its original (un-normalized) form. */
  readonly original: string;
  /** The matched string in normalized form (post-fullwidth, hyphen, etc). */
  readonly normalized: string;
}

/** A `DetectedMatch` annotated with the scope it was found in. */
export interface ScopedDetectedMatch {
  readonly scope: Scope;
  readonly match: DetectedMatch;
}

/**
 * Run every PII pattern against `text` and return the matches in original
 * form. The text is normalized once, then each pattern's regex is executed
 * against the normalized form; matches are sliced out of the *original*
 * text using the position map so the redactor receives literal bytes.
 *
 * Card matches are post-filtered with a Luhn check before being reported,
 * so callers don't see false positives from any 16-digit blob.
 */
export function detectPii(text: string): DetectedMatch[] {
  if (text.length === 0) return [];
  const map = normalizeForMatching(text);
  if (map.text.length === 0) return [];

  const out: DetectedMatch[] = [];

  for (const kind of PII_KINDS) {
    const pattern = PII_PATTERNS[kind];
    // Clone the regex per call so the `lastIndex` state from one detection
    // run can't pollute another. The cost is negligible (one regex compile
    // per kind per scope) and the safety is essential.
    const re = new RegExp(pattern.source, pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(map.text)) !== null) {
      const normalized = m[0];
      // Luhn check for cards: any 16-digit blob can match the regex, but
      // only Luhn-valid sequences are real cards. The design says
      // "Luhn-validated" — D7 row.
      if (kind === "card" && !luhnCheck(normalized)) continue;

      const startNorm = m.index;
      const endNorm = startNorm + normalized.length;
      // origOffsets has length map.text.length + 1 (normalized-space length +
      // sentinel), so endNorm (which can be map.text.length after any zero-width
      // stripping) is always in range. NOTE: length differs from original text
      // whenever normalizeForMatching dropped any zero-width codepoints.
      const startOrig = map.origOffsets[startNorm]!;
      const endOrig = map.origOffsets[endNorm]!;
      const original = text.slice(startOrig, endOrig);

      out.push({ kind, original, normalized });
    }
  }

  return out;
}

/**
 * Walk every text-bearing scope in `zip`, run `detectPii` on each, and
 * return the matches with their source scope attached. The order matches
 * `extractTextFromZip` (canonical scope walk order), and within a scope
 * matches are returned in pattern order (the iteration order of `PII_KINDS`)
 * with each pattern's matches in document order.
 */
export async function detectPiiInZip(
  zip: JSZip,
): Promise<ScopedDetectedMatch[]> {
  const out: ScopedDetectedMatch[] = [];
  const scoped = await extractTextFromZip(zip);
  for (const { scope, text } of scoped) {
    for (const match of detectPii(text)) {
      out.push({ scope, match });
    }
  }
  return out;
}

/**
 * The shipping shape: a deduped, sorted array of literal strings ready to
 * feed into `redactDocx({ targets })`. Sorted longest-first (so the redactor
 * matches greedy alternation correctly when one target is a substring of
 * another, e.g. `kim@abc.kr` vs `abc.kr`).
 */
export async function buildTargetsFromZip(zip: JSZip): Promise<string[]> {
  const matches = await detectPiiInZip(zip);
  const set = new Set<string>();
  for (const { match } of matches) {
    set.add(match.original);
  }
  // Longest-first ordering matches the redactor's `findRedactionMatches`
  // contract: when two targets are both prefixes of the input, the longer
  // one should win.
  return [...set].sort((a, b) => b.length - a.length);
}
