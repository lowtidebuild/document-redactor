import type JSZip from "jszip";

import type { ExtractedScopeText } from "../detection/extract-text.js";
import { coalesceParagraphRuns } from "./coalesce.js";
import { readZipEntry } from "./load.js";
import type {
  RenderedDocument,
  RenderedParagraph,
  RenderedScope,
} from "./render-body.js";
import { listScopes, readScopeXml } from "./scopes.js";
import type { Scope } from "./types.js";
import {
  extractFldSimpleInstrValues,
  extractInstrTexts,
  extractRelationshipTargets,
  listRelsPaths,
  type RelsTargetSurface,
  type ScopeInstrSurface,
  type ScopeTextSurface,
  type VerifySurfaces,
} from "./verify-surfaces.js";

const PARAGRAPH_RE =
  /<w:p(?!P|r)(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/w:p>)/g;

export interface ScopeArtifactCollection {
  readonly scopes: readonly Scope[];
  readonly scopedText: readonly ExtractedScopeText[];
  readonly renderedDoc: RenderedDocument;
  readonly verifySurfaces: VerifySurfaces;
}

export async function collectScopeArtifacts(
  zip: JSZip,
): Promise<ScopeArtifactCollection> {
  const scopes = listScopes(zip);
  const scopedText: ExtractedScopeText[] = [];
  const renderedScopes: RenderedScope[] = [];
  const scopeTextSurfaces: ScopeTextSurface[] = [];
  const scopeInstrSurfaces: ScopeInstrSurface[] = [];

  for (const scope of scopes) {
    const xml = await readScopeXml(zip, scope);
    const paragraphs = extractRenderedParagraphs(xml);
    const text = paragraphs.map((paragraph) => paragraph.text).join("\n");

    scopedText.push({ scope, text });
    renderedScopes.push({ scope, paragraphs });
    scopeTextSurfaces.push({ kind: "scope-text", scope, text });

    for (const instrText of extractInstrTexts(xml)) {
      scopeInstrSurfaces.push({
        kind: "scope-instr",
        scope,
        text: instrText,
      });
    }
    for (const instrText of extractFldSimpleInstrValues(xml)) {
      scopeInstrSurfaces.push({
        kind: "scope-instr",
        scope,
        text: instrText,
      });
    }
  }

  const { surfaces: relsTargetSurfaces, pathCount: relsPathCount } =
    await collectRelsTargetSurfaces(zip);

  return {
    scopes,
    scopedText,
    renderedDoc: { scopes: renderedScopes },
    verifySurfaces: {
      scopeTextSurfaces,
      scopeInstrSurfaces,
      relsTargetSurfaces,
      scopesChecked: scopeTextSurfaces.length + relsPathCount,
    },
  };
}

export function extractRenderedParagraphs(
  scopeXml: string,
): RenderedParagraph[] {
  const paragraphs: RenderedParagraph[] = [];
  const re = new RegExp(PARAGRAPH_RE.source, PARAGRAPH_RE.flags);

  let match: RegExpExecArray | null;
  let scopeIndex = 0;
  while ((match = re.exec(scopeXml)) !== null) {
    const { text } = coalesceParagraphRuns(match[0]);
    paragraphs.push({ scopeIndex, text });
    scopeIndex += 1;
  }

  return paragraphs;
}

async function collectRelsTargetSurfaces(
  zip: JSZip,
): Promise<{ surfaces: RelsTargetSurface[]; pathCount: number }> {
  const paths = listRelsPaths(zip);
  const surfaces: RelsTargetSurface[] = [];

  for (const path of paths) {
    const xml = await readZipEntry(zip, path);
    for (const text of extractRelationshipTargets(xml)) {
      surfaces.push({ kind: "rels-target", path, text });
    }
  }

  return { surfaces, pathCount: paths.length };
}
