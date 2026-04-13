import type JSZip from "jszip";

import { extractScopeText } from "../detection/extract-text.js";
import { listScopes, readScopeXml } from "./scopes.js";
import type { Scope } from "./types.js";

export interface ScopeTextSurface {
  readonly kind: "scope-text";
  readonly scope: Scope;
  readonly text: string;
}

export interface ScopeInstrSurface {
  readonly kind: "scope-instr";
  readonly scope: Scope;
  readonly text: string;
}

export interface RelsTargetSurface {
  readonly kind: "rels-target";
  readonly path: string;
  readonly text: string;
}

export interface VerifySurfaces {
  readonly scopeTextSurfaces: readonly ScopeTextSurface[];
  readonly scopeInstrSurfaces: readonly ScopeInstrSurface[];
  readonly relsTargetSurfaces: readonly RelsTargetSurface[];
  readonly scopesChecked: number;
}

export async function collectVerifySurfaces(zip: JSZip): Promise<VerifySurfaces> {
  const scopeTextSurfaces: ScopeTextSurface[] = [];
  const scopeInstrSurfaces: ScopeInstrSurface[] = [];

  for (const scope of listScopes(zip)) {
    const xml = await readScopeXml(zip, scope);
    scopeTextSurfaces.push({
      kind: "scope-text",
      scope,
      text: extractScopeText(xml),
    });
    for (const text of extractInstrTexts(xml)) {
      scopeInstrSurfaces.push({ kind: "scope-instr", scope, text });
    }
    for (const text of extractFldSimpleInstrValues(xml)) {
      scopeInstrSurfaces.push({ kind: "scope-instr", scope, text });
    }
  }

  const relsTargetSurfaces: RelsTargetSurface[] = [];
  for (const path of listRelsPaths(zip)) {
    const xml = await zip.file(path)!.async("string");
    for (const text of extractRelationshipTargets(xml)) {
      relsTargetSurfaces.push({ kind: "rels-target", path, text });
    }
  }

  return {
    scopeTextSurfaces,
    scopeInstrSurfaces,
    relsTargetSurfaces,
    scopesChecked: scopeTextSurfaces.length + listRelsPaths(zip).length,
  };
}

export function extractInstrTexts(xml: string): readonly string[] {
  const out: string[] = [];
  const re = /<w:instrText(?:\s[^>]*)?>([\s\S]*?)<\/w:instrText>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    out.push(decodeXml(match[1] ?? ""));
  }
  return out;
}

export function extractFldSimpleInstrValues(xml: string): readonly string[] {
  const out: string[] = [];
  const re = /<w:fldSimple\b[^>]*\bw:instr="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    out.push(decodeXml(match[1] ?? ""));
  }
  return out;
}

export function extractRelationshipTargets(relsXml: string): readonly string[] {
  const out: string[] = [];
  const re = /<Relationship\b[^>]*\bTarget="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(relsXml)) !== null) {
    out.push(decodeXml(match[1] ?? ""));
  }
  return out;
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

function decodeXml(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) =>
      String.fromCodePoint(Number.parseInt(dec, 10)),
    );
}
