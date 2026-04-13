/**
 * Flatten WordprocessingML field machinery to plain runs.
 *
 * Eng review lock-in #1 leak vector extension (post-Phase-3): complex and
 * simple fields embed their instruction text inside `<w:instrText>` runs and
 * `<w:fldSimple w:instr="...">` attributes, both of which the regular
 * `<w:t>`-scoped redactor does NOT see.
 *
 * Public API:
 *   - flattenFields(xml) → string
 *   - flattenFieldsInZip(zip) → Promise<void>
 */

import type JSZip from "jszip";

import { listScopes, readScopeXml } from "./scopes.js";

/**
 * Flatten every field and hyperlink in a single XML scope. Idempotent.
 */
export function flattenFields(xml: string): string {
  let out = xml;

  out = out.replace(
    /<w:r(?:\s[^>]*)?>(?:(?!<\/w:r>)[\s\S])*?<w:fldChar[^>]*\/>(?:(?!<\/w:r>)[\s\S])*?<\/w:r>/g,
    "",
  );

  out = out.replace(
    /<w:r(?:\s[^>]*)?>(?:(?!<\/w:r>)[\s\S])*?<w:instrText(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/w:instrText>)(?:(?!<\/w:r>)[\s\S])*?<\/w:r>/g,
    "",
  );

  out = out.replace(
    /<w:fldSimple(?:\s[^>]*)?>([\s\S]*?)<\/w:fldSimple>/g,
    "$1",
  );
  out = out.replace(/<w:fldSimple[^>]*\/>/g, "");

  out = out.replace(
    /<w:hyperlink(?:\s[^>]*)?>([\s\S]*?)<\/w:hyperlink>/g,
    "$1",
  );
  out = out.replace(/<w:hyperlink[^>]*\/>/g, "");

  return out;
}

/**
 * Apply `flattenFields` to every text-bearing scope in a zip in place.
 */
export async function flattenFieldsInZip(zip: JSZip): Promise<void> {
  for (const scope of listScopes(zip)) {
    const xml = await readScopeXml(zip, scope);
    const flattened = flattenFields(xml);
    if (flattened !== xml) {
      zip.file(scope.path, flattened);
    }
  }
}
