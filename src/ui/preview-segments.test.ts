import { describe, expect, it } from "vitest";

import {
  buildPreviewSegments,
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
