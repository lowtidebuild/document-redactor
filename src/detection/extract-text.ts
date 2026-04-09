/**
 * Plain-text extractor — turns a DOCX scope's XML into the visible text
 * a regex sweep can run on.
 *
 * Lane A's regex patterns and Lane C's variant propagation both need to see
 * the document the way a human reads it: a stream of words, not a soup of
 * formatting tags. This module is the bridge.
 *
 * Implementation: walks every `<w:p>...</w:p>` paragraph in the scope using
 * the same negative-lookahead trick the redactor uses (`<w:p(?!P|r)`) so
 * `<w:pPr>` and `<w:proof>` blocks are never confused for paragraphs, then
 * passes each paragraph to `coalesceParagraphRuns` to extract the visible
 * text. Paragraphs are joined with `\n` so downstream code can do per-line
 * detection (e.g. defined-term parsing in Lane C). Tables are walked
 * automatically because table cells contain ordinary `<w:p>` elements.
 *
 * The output is a plain string. The original XML offsets are NOT preserved
 * here — by design. Lane A only needs the *string content* of each match;
 * the redactor (Lane B) does its own coalescing and offset bookkeeping when
 * it actually rewrites the XML. Detection and rewriting are decoupled.
 *
 * Public API:
 *   - `extractScopeText(scopeXml)` — pure, sync. Returns the joined text.
 *   - `extractTextFromZip(zip)` — async, walks every scope via the canonical
 *     `listScopes` walker so any new scope kind is picked up automatically.
 */

import type JSZip from "jszip";

import { coalesceParagraphRuns } from "../docx/coalesce.js";
import { listScopes, readScopeXml } from "../docx/scopes.js";
import type { Scope } from "../docx/types.js";

/**
 * One scope's extracted text plus the scope it came from. The scope is
 * carried through so callers can attribute matches to the source location
 * (body / header1 / footer1 / footnotes / ...) for the audit log and the
 * verifier's leak report.
 */
export interface ExtractedScopeText {
  readonly scope: Scope;
  readonly text: string;
}

/**
 * Walk every text-bearing scope in the zip and return its plain text. The
 * walk order matches `listScopes` (body → footnotes → endnotes → comments →
 * headers → footers) so callers can rely on a stable ordering when building
 * audit logs.
 */
export async function extractTextFromZip(
  zip: JSZip,
): Promise<ExtractedScopeText[]> {
  const out: ExtractedScopeText[] = [];
  for (const scope of listScopes(zip)) {
    const xml = await readScopeXml(zip, scope);
    out.push({ scope, text: extractScopeText(xml) });
  }
  return out;
}

/**
 * Pure synchronous form: given the raw XML for one scope, return the visible
 * text. Paragraphs are joined with `\n`. An empty scope (no `<w:p>` elements)
 * yields the empty string.
 */
export function extractScopeText(scopeXml: string): string {
  // The negative lookahead `(?!P|r)` rejects `<w:pPr>`, `<w:proof...>`, etc.,
  // which would otherwise satisfy the optional whitespace branch and produce
  // bogus paragraph captures. Same trick the redactor uses in redact.ts.
  const PARA_RE =
    /<w:p(?!P|r)(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/w:p>)/g;

  const parts: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = PARA_RE.exec(scopeXml)) !== null) {
    // Self-closing `<w:p/>` has no content; skip without emitting an entry
    // so consecutive empty paragraphs don't bloat the joined output.
    const paragraphXml = match[0];
    const text = coalesceParagraphRuns(paragraphXml).text;
    parts.push(text);
  }

  return parts.join("\n");
}
