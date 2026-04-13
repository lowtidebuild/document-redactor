/**
 * Round-trip verifier — the zero-miss safety net.
 *
 * Eng review lock-in #2: after every redaction pipeline run, the OUTPUT
 * DOCX is re-parsed, every text-bearing scope is walked, and every string
 * in the original sensitive list is searched for. If even one survived,
 * the download is BLOCKED and the user is shown which strings, in which
 * scopes, escaped the redactor.
 *
 * This is the mechanism that converts the redactor's regex imperfection
 * into a *detectable* error instead of a silent leak. It is the single
 * most important non-invariant safety mechanism in the entire product.
 *
 * Critical property: this verifier intentionally does NOT trust the redactor
 * that produced the output. It re-loads the bytes from scratch, walks the
 * scopes via the same scope walker the redactor uses, and searches with
 * plain string indexOf — no regex, no normalization, no clever tricks. It
 * is the dumbest, most direct check we can possibly run, and that is the
 * point: if anything in the redactor pipeline is wrong (a regex bug, a
 * coalescer bug, a missed scope), this verifier catches it.
 *
 * Public API:
 *   - verifyRedaction(zip, sensitiveStrings) → VerifyResult
 *     Walks every text-bearing scope and reports any sensitive string that
 *     survived. Empty `survived` array means a clean output.
 *   - VerifyResult.isClean — convenience boolean for the ship gate.
 */

import type JSZip from "jszip";

import { listScopes, readScopeXml } from "./scopes.js";
import type { Scope } from "./types.js";

/** One sensitive string that survived in one scope. */
export interface SurvivedString {
  /** The literal sensitive string that should not have been present. */
  readonly text: string;
  /** Which scope the survival was found in. */
  readonly scope: Scope;
  /** How many times the string appeared in this scope. */
  readonly count: number;
}

/** Outcome of one verification pass. */
export interface VerifyResult {
  /** True iff zero sensitive strings survived. The ship gate. */
  readonly isClean: boolean;
  /** Every survival, grouped by (string, scope). Empty when isClean is true. */
  readonly survived: ReadonlyArray<SurvivedString>;
  /** How many text-bearing scopes were walked. */
  readonly scopesChecked: number;
  /** How many sensitive strings were tested. */
  readonly stringsTested: number;
}

/**
 * Verify that none of the given sensitive strings appear in any text-bearing
 * scope of the given DOCX zip. Reads scope XML, runs plain-string indexOf
 * scans, returns a structured report.
 *
 * No regex, no Unicode normalization, no run coalescing — by design. If the
 * redactor's coalescer was buggy and "ABC Corporation" survived as
 * `<w:t>ABC</w:t><w:t> Corporation</w:t>`, the indexOf scan against the
 * raw XML scope content would still find both `ABC` and `Corporation`
 * substrings. So callers should pass the FULL sensitive string AND any
 * obvious sub-string anchors (e.g. just the company name) for double safety.
 *
 * The trade-off is: the indexOf scan can produce false positives (e.g.
 * the string "Sunrise" appearing inside an unrelated XML attribute name).
 * That's an acceptable cost for the safety guarantee — false positives
 * make the user re-run with Paranoid mode or add manual aliases, false
 * negatives leak.
 */
export async function verifyRedaction(
  zip: JSZip,
  sensitiveStrings: ReadonlyArray<string>,
): Promise<VerifyResult> {
  // Filter empty / dedupe — empty would match every position; dupes are wasted work.
  const targets = [...new Set(sensitiveStrings.filter((s) => s.length > 0))];

  // Walk every text-bearing scope, including comments — the comments
  // file should already be gone by this point (dropCommentsPart) but
  // we walk it defensively in case the orchestrator forgot.
  const scopes = listScopes(zip);
  const survived: SurvivedString[] = [];

  for (const scope of scopes) {
    const xml = await readScopeXml(zip, scope);
    for (const target of targets) {
      const count = countOccurrences(xml, target);
      if (count > 0) {
        survived.push({ text: target, scope, count });
      }
    }
  }

  const relsPaths = listRelsPaths(zip);
  for (const relsPath of relsPaths) {
    const relsXml = await zip.file(relsPath)!.async("string");
    for (const target of targets) {
      const count = countOccurrences(relsXml, target);
      if (count > 0) {
        survived.push({
          text: target,
          scope: { kind: "rels", path: relsPath } as unknown as Scope,
          count,
        });
      }
    }
  }

  return {
    isClean: survived.length === 0,
    survived,
    scopesChecked: scopes.length + relsPaths.length,
    stringsTested: targets.length,
  };
}

function listRelsPaths(zip: JSZip): string[] {
  const paths: string[] = [];
  zip.forEach((relativePath, file) => {
    if (file.dir) return;
    if (relativePath.endsWith(".rels")) {
      paths.push(relativePath);
    }
  });
  return paths.sort();
}

/**
 * Count non-overlapping occurrences of `needle` in `haystack` using a
 * simple indexOf walk. Faster and more predictable than `RegExp` for
 * literal substring counting.
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
