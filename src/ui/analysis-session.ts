import { loadDocxZip } from "../docx/load.js";
import type { RenderedDocument } from "../docx/render-body.js";
import { collectScopeArtifacts } from "../docx/scope-artifacts.js";
import type { VerifySurfaces } from "../docx/verify-surfaces.js";
import type { ExtractedScopeText } from "../detection/extract-text.js";
import type { Analysis, FileStats } from "./engine.js";

export interface DocumentAnalysisSnapshot {
  readonly bytes: Uint8Array;
  readonly fileStats: FileStats;
  readonly scopedText: readonly ExtractedScopeText[];
  readonly renderedDoc: Promise<RenderedDocument>;
  readonly verifySurfaces: VerifySurfaces;
}

export interface DocumentAnalysisSession extends DocumentAnalysisSnapshot {
  readonly analysis: Analysis;
}

export async function createDocumentAnalysisSnapshot(
  bytes: Uint8Array,
): Promise<DocumentAnalysisSnapshot> {
  const zip = await loadDocxZip(bytes);
  const artifacts = await collectScopeArtifacts(zip);
  const fileStats: FileStats = {
    sizeBytes: bytes.length,
    scopeCount: artifacts.scopes.length,
  };

  return {
    bytes,
    fileStats,
    scopedText: artifacts.scopedText,
    renderedDoc: Promise.resolve(artifacts.renderedDoc),
    verifySurfaces: artifacts.verifySurfaces,
  };
}

export function attachAnalysisToSession(
  snapshot: DocumentAnalysisSnapshot,
  analysis: Analysis,
): DocumentAnalysisSession {
  return { ...snapshot, analysis };
}

export function replaceSessionAnalysis(
  session: DocumentAnalysisSession,
  analysis: Analysis,
): DocumentAnalysisSession {
  return { ...session, analysis };
}
