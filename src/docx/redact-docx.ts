/**
 * The DOCX redaction orchestrator — Lane B's top-level entry point.
 *
 * Wires the individual modules together into the canonical pipeline:
 *
 *   1. Walk text-bearing scopes (body, headers, footers, footnotes, endnotes)
 *   2. For each scope:
 *      a. flatten track changes (drop <w:del>, unwrap <w:ins>) — leak vector #1
 *      b. strip comment range markers and references — leak vector #2
 *      c. cross-run redaction via the coalescer (the silent-leak fix)
 *   3. Drop the comments part and any companion comment files
 *   4. Scrub docProps metadata (creator, lastModifiedBy, title, etc.)
 *   5. Round-trip verify the result — block download if anything survived
 *
 * Steps 1–4 are the "happy path" mutations. Step 5 is the safety net that
 * makes the whole thing a zero-miss product instead of a 95%-accuracy product.
 *
 * The orchestrator does NOT handle:
 *   - DOCX file load / save (caller's job — use JSZip.loadAsync /
 *     zip.generateAsync at the boundaries)
 *   - Detection regex (Lane A — produces the targets list)
 *   - Variant propagation / D9 classifier (Lane C — also produces targets)
 *   - UI state (Lane E)
 *
 * Public API:
 *   - redactDocx(zip, options) → RedactionReport
 *   - applyDocxMutations(zip, targets) — internal helper, exported for
 *     fine-grained tests
 */

import type JSZip from "jszip";

import {
  buildResolvedTargetsFromStrings,
  type ResolvedRedactionTarget,
} from "../selection-targets.js";
import { flattenFieldsInZip } from "./flatten-fields.js";
import { flattenTrackChanges } from "./flatten-track-changes.js";
import { redactScopeXml, DEFAULT_PLACEHOLDER } from "./redact.js";
import { listScopes, readScopeXml } from "./scopes.js";
import {
  dropCommentsPart,
  stripCommentReferences,
} from "./strip-comments.js";
import { scrubDocxMetadata } from "./scrub-metadata.js";
import { verifyRedaction, type VerifyResult } from "./verify.js";
import type { Scope } from "./types.js";

/** Inputs to the orchestrator. */
export interface RedactDocxOptions {
  /**
   * The literal sensitive strings to redact. Built by the caller via
   * Lane A (regex) + Lane C (variant propagation, D9 classifier). The
   * orchestrator does not produce or filter this list.
   */
  readonly targets: ReadonlyArray<string>;
  /** Structured verification payload. Defaults to wrapping `targets` 1:1. */
  readonly verifyTargets?: ReadonlyArray<ResolvedRedactionTarget>;
  /**
   * Override the placeholder string. Defaults to `[REDACTED]` per D8.4.
   * The production UI never overrides this; the parameter exists so tests
   * can use a distinct marker for clarity.
   */
  readonly placeholder?: string;
}

/** Per-scope mutation summary. */
export interface ScopeMutationReport {
  readonly scope: Scope;
  readonly bytesBefore: number;
  readonly bytesAfter: number;
}

/** Outcome of a full pipeline run. */
export interface RedactionReport {
  /** Per-scope size deltas (mutation evidence). */
  readonly scopeMutations: ReadonlyArray<ScopeMutationReport>;
  /** Round-trip verification result. `verify.isClean` is the ship gate. */
  readonly verify: VerifyResult;
}

/**
 * Run the full redaction pipeline against a loaded DOCX zip in place.
 * The caller is responsible for loading bytes into the zip beforehand
 * (e.g. `JSZip.loadAsync(buf)`) and writing the result out afterwards
 * (e.g. `zip.generateAsync({type:"blob"})`).
 *
 * Returns a `RedactionReport` whose `verify.isClean` is the **download
 * gate**: if false, the UI MUST block the download and surface the
 * surviving strings to the user.
 */
export async function redactDocx(
  zip: JSZip,
  options: RedactDocxOptions,
): Promise<RedactionReport> {
  const placeholder = options.placeholder ?? DEFAULT_PLACEHOLDER;
  const targets = options.targets;

  // Step 1–2: walk text-bearing scopes (excluding the comments file itself,
  // which we delete entirely later) and flatten track changes + comment refs.
  const textScopes = listScopes(zip).filter((s) => s.kind !== "comments");
  const bytesBefore = new Map<string, number>();
  const scopeMutations: ScopeMutationReport[] = [];

  for (const scope of textScopes) {
    let xml = await readScopeXml(zip, scope);
    bytesBefore.set(scope.path, xml.length);

    xml = flattenTrackChanges(xml);
    xml = stripCommentReferences(xml);
    zip.file(scope.path, xml);
  }

  // Step 3: delete comments.xml + companion parts entirely.
  dropCommentsPart(zip);

  // Step 3.5: flatten field machinery and hyperlink wrappers before redaction.
  await flattenFieldsInZip(zip);

  // Step 4: redact each text-bearing scope after the XML has been flattened.
  for (const scope of textScopes) {
    const xml = await readScopeXml(zip, scope);
    const redacted = redactScopeXml(xml, targets, placeholder);
    zip.file(scope.path, redacted);
    scopeMutations.push({
      scope,
      bytesBefore: bytesBefore.get(scope.path) ?? xml.length,
      bytesAfter: redacted.length,
    });
  }

  // Step 5: scrub document metadata (author, lastModifiedBy, title, ...).
  await scrubDocxMetadata(zip);

  // Step 6: round-trip verify against the same target list. If any sensitive
  // string survived, the verifier flags it; the caller blocks the download.
  const verify = await verifyRedaction(
    zip,
    options.verifyTargets ?? buildResolvedTargetsFromStrings(targets),
  );

  return { scopeMutations, verify };
}
