/**
 * Rule runner — Phase 0 implements only the regex phase.
 * Structural and heuristic phases will be added in Phase 2 and Phase 4.
 *
 * See docs/RULES_GUIDE.md § 3.4 for the three-shape design rationale and
 * § 10.3 for the level filter semantics.
 *
 * Phase 0 does NOT filter by language — that would change observable behavior
 * vs v1.0 (which runs all rules regardless of document language). Language
 * filtering will be added in Phase 1 when it can be tested against a richer
 * rule set. The `detectLanguage` helper exists in this directory for Phase 1's
 * convenience; this runner just does not use it yet.
 */

import { normalizeForMatching } from "../normalize.js";

import type { Candidate, Level, RegexRule } from "./types.js";

/**
 * Run every RegexRule that matches the given level, return candidates with
 * original byte recovery via the normalizeForMatching offset map.
 *
 * Does NOT deduplicate. Callers run dedup on the combined output of all phases
 * (see `buildTargetsFromZip` for the current Set-based dedup).
 */
export function runRegexPhase(
  text: string,
  level: Level,
  rules: readonly RegexRule[],
): Candidate[] {
  if (text.length === 0) return [];
  const map = normalizeForMatching(text);
  if (map.text.length === 0) return [];

  // Phase 0: level filter only. Language filter deferred to Phase 1.
  const active = rules.filter((r) => r.levels.includes(level));

  const out: Candidate[] = [];

  for (const rule of active) {
    // Clone per rule to avoid lastIndex state pollution across calls and runs.
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(map.text)) !== null) {
      const normalized = m[0];
      if (rule.postFilter && !rule.postFilter(normalized)) continue;

      const startNorm = m.index;
      const endNorm = startNorm + normalized.length;
      // origOffsets has length map.text.length + 1 (sentinel at end), so
      // endNorm (which can be map.text.length after zero-width stripping)
      // is always in range. NOTE: the sentinel is indexed by the NORMALIZED
      // length, not the ORIGINAL length — the two differ whenever
      // normalizeForMatching stripped any zero-width codepoints.
      const startOrig = map.origOffsets[startNorm]!;
      const endOrig = map.origOffsets[endNorm]!;
      const original = text.slice(startOrig, endOrig);

      out.push({
        text: original,
        ruleId: rule.id,
        confidence: 1.0,
      });
    }
  }

  return out;
}
