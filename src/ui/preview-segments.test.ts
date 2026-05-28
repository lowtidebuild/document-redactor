import { describe, expect, it } from "vitest";

import {
  buildPreviewSegmentIndex,
  buildPreviewSegments,
  resolvePreviewSegments,
  type PreviewCandidate,
} from "./preview-segments.js";

function markSummary(candidates: readonly PreviewCandidate[], text: string) {
  return buildPreviewSegments(text, candidates, 0, 0)
    .filter((segment) => segment.type === "mark")
    .map((segment) => ({
      selectionTargetId: segment.selectionTargetId,
      text: segment.text,
      candidate: segment.candidate,
      selected: segment.selected,
    }));
}

describe("buildPreviewSegments", () => {
  it("prefers a selected short candidate over an overlapping unchecked long candidate", () => {
    const marks = markSummary(
      [
        { selectionTargetId: "auto:abc", text: "ABC", selected: true },
        { selectionTargetId: "auto:abc-corp", text: "ABC Corp", selected: false },
      ],
      "ABC Corp signed the agreement",
    );

    expect(marks).toEqual([
      {
        selectionTargetId: "auto:abc",
        text: "ABC",
        candidate: "ABC",
        selected: true,
      },
    ]);
  });

  it("keeps a selected long candidate over an overlapping unchecked short candidate", () => {
    const marks = markSummary(
      [
        { selectionTargetId: "auto:abc-corp", text: "ABC Corp", selected: true },
        { selectionTargetId: "auto:abc", text: "ABC", selected: false },
      ],
      "ABC Corp signed the agreement",
    );

    expect(marks).toEqual([
      {
        selectionTargetId: "auto:abc-corp",
        text: "ABC Corp",
        candidate: "ABC Corp",
        selected: true,
      },
    ]);
  });

  it("keeps unchecked non-overlapping candidates visible", () => {
    const marks = markSummary(
      [
        { selectionTargetId: "auto:abc", text: "ABC", selected: true },
        { selectionTargetId: "auto:sunrise", text: "Sunrise", selected: false },
      ],
      "ABC signed with Sunrise Ventures",
    );

    expect(marks).toEqual([
      {
        selectionTargetId: "auto:abc",
        text: "ABC",
        candidate: "ABC",
        selected: true,
      },
      {
        selectionTargetId: "auto:sunrise",
        text: "Sunrise",
        candidate: "Sunrise",
        selected: false,
      },
    ]);
  });

  it("still resolves overlaps longest-first within selected candidates", () => {
    const marks = markSummary(
      [
        { selectionTargetId: "auto:abc", text: "ABC", selected: true },
        { selectionTargetId: "auto:abc-corp", text: "ABC Corp", selected: true },
      ],
      "ABC Corp signed the agreement",
    );

    expect(marks).toEqual([
      {
        selectionTargetId: "auto:abc-corp",
        text: "ABC Corp",
        candidate: "ABC Corp",
        selected: true,
      },
    ]);
  });

  it("preserves normalized fallback matching for selected candidates", () => {
    const marks = markSummary(
      [{ selectionTargetId: "auto:abc", text: "ABC", selected: true }],
      "A\u200BBC signed the agreement",
    );

    expect(marks).toEqual([
      {
        selectionTargetId: "auto:abc",
        text: "A\u200BBC",
        candidate: "ABC",
        selected: true,
      },
    ]);
  });
});

describe("preview segment index", () => {
  it("reuses one paragraph index across different selection states", () => {
    const index = buildPreviewSegmentIndex(
      "ABC Corp signed the agreement",
      [
        { selectionTargetId: "auto:abc", text: "ABC" },
        { selectionTargetId: "auto:abc-corp", text: "ABC Corp" },
      ],
      0,
      0,
    );

    const shortSelected = resolvePreviewSegments(index, new Set(["auto:abc"]));
    const longSelected = resolvePreviewSegments(
      index,
      new Set(["auto:abc-corp"]),
    );

    expect(markOnly(shortSelected)).toEqual([
      {
        selectionTargetId: "auto:abc",
        text: "ABC",
        candidate: "ABC",
        selected: true,
      },
    ]);
    expect(markOnly(longSelected)).toEqual([
      {
        selectionTargetId: "auto:abc-corp",
        text: "ABC Corp",
        candidate: "ABC Corp",
        selected: true,
      },
    ]);
  });

  it("updates selected state without rebuilding candidate matches", () => {
    const index = buildPreviewSegmentIndex(
      "ABC signed with Sunrise Ventures",
      [
        { selectionTargetId: "auto:abc", text: "ABC" },
        { selectionTargetId: "auto:sunrise", text: "Sunrise" },
      ],
      0,
      0,
    );

    const unchecked = resolvePreviewSegments(index, new Set());
    const selected = resolvePreviewSegments(index, new Set(["auto:sunrise"]));

    expect(markOnly(unchecked)).toEqual([
      {
        selectionTargetId: "auto:abc",
        text: "ABC",
        candidate: "ABC",
        selected: false,
      },
      {
        selectionTargetId: "auto:sunrise",
        text: "Sunrise",
        candidate: "Sunrise",
        selected: false,
      },
    ]);
    expect(markOnly(selected)).toEqual([
      {
        selectionTargetId: "auto:abc",
        text: "ABC",
        candidate: "ABC",
        selected: false,
      },
      {
        selectionTargetId: "auto:sunrise",
        text: "Sunrise",
        candidate: "Sunrise",
        selected: true,
      },
    ]);
  });

  it("keeps normalized fallback matches in the reusable index", () => {
    const index = buildPreviewSegmentIndex(
      "A\u200BBC signed the agreement",
      [{ selectionTargetId: "auto:abc", text: "ABC" }],
      0,
      0,
    );

    expect(markOnly(resolvePreviewSegments(index, new Set(["auto:abc"])))).toEqual([
      {
        selectionTargetId: "auto:abc",
        text: "A\u200BBC",
        candidate: "ABC",
        selected: true,
      },
    ]);
  });
});

function markOnly(segments: ReturnType<typeof buildPreviewSegments>) {
  return segments
    .filter((segment) => segment.type === "mark")
    .map((segment) => ({
      selectionTargetId: segment.selectionTargetId,
      text: segment.text,
      candidate: segment.candidate,
      selected: segment.selected,
    }));
}
