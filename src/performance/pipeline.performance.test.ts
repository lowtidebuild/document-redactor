import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  analyzeDocumentSession,
  applyRedaction,
  defaultSelections,
} from "../ui/engine.js";
import {
  buildPreviewSegmentIndex,
  resolvePreviewSegments,
  type PreviewSegmentCandidate,
  type PreviewSegmentIndex,
} from "../ui/preview-segments.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const FIXTURE = path.join(
  REPO_ROOT,
  "tests/fixtures/bilingual_nda_worst_case.docx",
);

const SEEDS: ReadonlyArray<string> = [
  "ABC Corporation",
  "Sunrise Ventures LLC",
  "ABC 주식회사",
  "김철수",
  "이영희",
  "Project Falcon",
  "블루윙 2.0",
];

interface Metric {
  readonly name: string;
  readonly elapsedMs: number;
  readonly budgetMs: number;
  readonly details: Record<string, number>;
}

describe("pipeline performance smoke", () => {
  it("keeps the fixture analysis, preview, and apply flow within loose budgets", async () => {
    const bytes = readFileSync(FIXTURE);

    const analyzeStarted = performance.now();
    const session = await analyzeDocumentSession(bytes, SEEDS);
    const renderedDoc = await session.renderedDoc;
    const analyzeElapsed = performance.now() - analyzeStarted;

    const selections = defaultSelections(session.analysis);
    const paragraphCount = renderedDoc.scopes.reduce(
      (sum, scope) => sum + scope.paragraphs.length,
      0,
    );

    const previewCandidates = buildPreviewCandidates(
      session.analysis.selectionTargets,
    );
    const previewStarted = performance.now();
    const previewIndexes: PreviewSegmentIndex[] = [];
    let segmentCount = 0;
    for (const [scopeIndex, scope] of renderedDoc.scopes.entries()) {
      for (const paragraph of scope.paragraphs) {
        const index = buildPreviewSegmentIndex(
          paragraph.text,
          previewCandidates,
          scopeIndex,
          paragraph.scopeIndex,
        );
        previewIndexes.push(index);
        segmentCount += resolvePreviewSegments(index, selections).length;
      }
    }
    const previewElapsed = performance.now() - previewStarted;

    const toggledSelections = new Set(selections);
    const firstCandidateId = previewCandidates[0]?.selectionTargetId;
    if (firstCandidateId !== undefined) {
      if (toggledSelections.has(firstCandidateId)) {
        toggledSelections.delete(firstCandidateId);
      } else {
        toggledSelections.add(firstCandidateId);
      }
    }
    const previewToggleStarted = performance.now();
    let toggleSegmentCount = 0;
    for (const index of previewIndexes) {
      toggleSegmentCount += resolvePreviewSegments(index, toggledSelections).length;
    }
    const previewToggleElapsed = performance.now() - previewToggleStarted;

    const applyStarted = performance.now();
    const report = await applyRedaction(bytes, session.analysis, selections, {
      preflightSurfaces: session.verifySurfaces,
    });
    const applyElapsed = performance.now() - applyStarted;

    expect(report.verify.isClean).toBe(true);
    expect(report.wordCount.sane).toBe(true);
    expect(report.outputBytes.length).toBeGreaterThan(0);

    const metrics: Metric[] = [
      {
        name: "analyzeDocumentSession+renderedDoc",
        elapsedMs: analyzeElapsed,
        budgetMs: 5_000,
        details: {
          bytes: bytes.length,
          scopes: session.fileStats.scopeCount,
          paragraphs: paragraphCount,
          candidates: session.analysis.selectionTargets.length,
        },
      },
      {
        name: "previewSegmentIndex+initialResolve",
        elapsedMs: previewElapsed,
        budgetMs: 1_500,
        details: {
          paragraphs: paragraphCount,
          candidates: previewCandidates.length,
          segments: segmentCount,
        },
      },
      {
        name: "previewSelectionToggleResolve",
        elapsedMs: previewToggleElapsed,
        budgetMs: 500,
        details: {
          paragraphs: paragraphCount,
          candidates: previewCandidates.length,
          segments: toggleSegmentCount,
        },
      },
      {
        name: "applyRedaction",
        elapsedMs: applyElapsed,
        budgetMs: 8_000,
        details: {
          selectedTargets: selections.size,
          outputBytes: report.outputBytes.length,
          verifyScopes: report.verify.scopesChecked,
          verifyStrings: report.verify.stringsTested,
        },
      },
    ];

    for (const metric of metrics) {
      expectWithinBudget(metric);
    }
  });
});

function buildPreviewCandidates(
  selectionTargets: readonly { id: string; displayText: string }[],
): PreviewSegmentCandidate[] {
  return [...selectionTargets]
    .sort(
      (a, b) =>
        b.displayText.length - a.displayText.length ||
        a.displayText.localeCompare(b.displayText),
    )
    .map((target) => ({
      selectionTargetId: target.id,
      text: target.displayText,
    }));
}

function expectWithinBudget(metric: Metric): void {
  if (metric.elapsedMs < metric.budgetMs) return;
  throw new Error(
    `${metric.name} exceeded ${metric.budgetMs}ms budget: ` +
      `${metric.elapsedMs.toFixed(1)}ms; details=${JSON.stringify(metric.details)}`,
  );
}
