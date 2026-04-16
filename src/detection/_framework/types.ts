import type { PositionMap } from "../normalize.js";

/**
 * Rule framework types — Phase 0.
 *
 * Defines the three rule shapes (RegexRule, StructuralParser, Heuristic) plus
 * supporting types (Candidate, StructuralDefinition, Level, Language, HeuristicContext).
 *
 * See docs/RULES_GUIDE.md § 3 for the rationale behind having three shapes
 * instead of one unified interface.
 *
 * Phase 0 exercises only RegexRule. StructuralParser and Heuristic are defined
 * here for forward compatibility with Phase 2 and Phase 4; their runners will
 * be added in those phases.
 */

/** UI tier per design-v1.md § Eng Review Lock-in #4. */
export type Level = "conservative" | "standard" | "paranoid";

/** Language a rule applies to. "universal" = runs regardless of document language. */
export type Language = "ko" | "en" | "universal";

/** All rule categories per docs/RULES_GUIDE.md § 2. */
export type Category =
  | "identifiers"
  | "financial"
  | "temporal"
  | "entities"
  | "structural"
  | "heuristics"
  | "legal";

/**
 * Post-filter receives the normalized matched string and returns true to keep
 * the match, false to reject (false positive). Example: Luhn check for credit
 * cards. Post-filters must be pure functions — no I/O, no state, no mutation.
 */
export type PostFilter = (normalizedMatch: string) => boolean;

/**
 * A regex-based detection rule. The runner handles normalization, exec loop,
 * original-byte recovery via offset map, and post-filter application.
 *
 * Invariants (enforced at registration time in registry.ts):
 *   - `pattern.flags` must include "g"
 *   - `pattern` must be bounded (see docs/RULES_GUIDE.md § 7 ReDoS checklist)
 *   - `levels` and `languages` must be non-empty arrays
 *   - `id` must be unique across all categories
 *   - `category` excludes "structural" and "heuristics" (those shapes have
 *     different interfaces in this file)
 */
export interface RegexRule {
  /** Dotted id: "{category}.{subcategory}". Unique across all rules. */
  readonly id: string;
  readonly category: Exclude<Category, "structural" | "heuristics">;
  readonly subcategory: string;
  /** Must have the `g` flag. Cloned per call to avoid lastIndex pollution. */
  readonly pattern: RegExp;
  /** Optional false-positive rejection applied to the NORMALIZED match. */
  readonly postFilter?: PostFilter;
  readonly levels: readonly Level[];
  readonly languages: readonly Language[];
  /** One-line human summary. Surfaces in audit log + rule catalog. */
  readonly description: string;
}

/**
 * Structured context extracted by a StructuralParser. Used by later phases
 * (heuristics) for D9 defined-term awareness and role classification.
 *
 * IMPORTANT naming: this type is `StructuralDefinition`, not `DefinedTerm`.
 * A separate `DefinedTerm` concept already exists at
 * `src/propagation/defined-terms.ts` for Lane C's role-word classifier
 * (matches tokens like "the Buyer" / "매수인" / "갑" from seed propagation).
 * That is NOT this type. Keep the two distinct.
 */
export interface StructuralDefinition {
  /** The label used in the document: "the Buyer", "매수인", "'갑'" */
  readonly label: string;
  /** The entity the label refers to: "ABC Corporation", "사과회사" */
  readonly referent: string;
  readonly source: "definition-section" | "recitals" | "party-declaration";
}

/**
 * Position-dependent parser. Runs BEFORE regex rules and heuristics. Output
 * is used as context for heuristics. Not implemented in Phase 0 — interface
 * only. Phase 2 will add the first implementations.
 */
export interface StructuralParser {
  readonly id: string;
  readonly category: "structural";
  readonly subcategory: string;
  readonly languages: readonly Language[];
  readonly description: string;
  parse(normalizedText: string): readonly StructuralDefinition[];
}

/**
 * A single detection result. Regex rules emit these with confidence 1.0.
 * Heuristics emit them with confidence < 1.0 based on signal strength.
 */
export interface Candidate {
  /** Original bytes (NOT normalized). Literal string for the redactor. */
  readonly text: string;
  /** Provenance: which rule fired this candidate. Dotted id from the rule. */
  readonly ruleId: string;
  /** 0..1. Regex rules = 1.0. Heuristics vary. */
  readonly confidence: number;
}

/**
 * Input context passed to Heuristic.detect(). Heuristics consume:
 *  - structuralDefinitions (from structural phase) to skip D9 defined labels
 *  - priorCandidates (from regex phase) to avoid double-counting
 *  - documentLanguage (from runner) to filter role blacklists
 *  - originalText + map (from runner) to recover original bytes for emitted
 *    candidates without re-normalizing
 */
export interface HeuristicContext {
  readonly structuralDefinitions: readonly StructuralDefinition[];
  readonly priorCandidates: readonly Candidate[];
  readonly documentLanguage: "ko" | "en" | "mixed";
  readonly originalText?: string;
  readonly map?: PositionMap;
}

/**
 * Fuzzy / context-aware detection rule. Not implemented in Phase 0 — interface
 * only. Phase 4 will add the first implementations.
 */
export interface Heuristic {
  readonly id: string;
  readonly category: "heuristics";
  readonly subcategory: string;
  readonly languages: readonly Language[];
  readonly levels: readonly Level[];
  readonly description: string;
  detect(normalizedText: string, context: HeuristicContext): readonly Candidate[];
}
