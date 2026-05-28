import { normalizeForMatching } from "../detection/normalize.js";

export interface PreviewCandidate {
  readonly selectionTargetId: string;
  readonly text: string;
  readonly selected: boolean;
}

export interface PreviewSegmentCandidate {
  readonly selectionTargetId: string;
  readonly text: string;
}

export interface PreviewMarkSpan {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly selectionTargetId: string;
  readonly candidate: string;
  readonly order: number;
}

export type PreviewSegment =
  | { readonly type: "text"; readonly key: string; readonly text: string }
  | {
      readonly type: "mark";
      readonly key: string;
      readonly text: string;
      readonly selectionTargetId: string;
      readonly candidate: string;
      readonly selected: boolean;
    };

export interface PreviewCandidateMarks {
  readonly selectionTargetId: string;
  readonly text: string;
  readonly order: number;
  readonly rawMarks: readonly PreviewMarkSpan[];
  readonly fallbackMarks: readonly PreviewMarkSpan[];
}

export interface PreviewSegmentIndex {
  readonly paragraphText: string;
  readonly scopeIndex: number;
  readonly paragraphIndex: number;
  readonly candidates: readonly PreviewCandidateMarks[];
}

export function buildPreviewSegments(
  paragraphText: string,
  candidates: readonly PreviewCandidate[],
  scopeIndex: number,
  paragraphIndex: number,
): PreviewSegment[] {
  const selectedIds = new Set(
    candidates
      .filter((candidate) => candidate.selected)
      .map((candidate) => candidate.selectionTargetId),
  );
  return resolvePreviewSegments(
    buildPreviewSegmentIndex(
      paragraphText,
      candidates,
      scopeIndex,
      paragraphIndex,
    ),
    selectedIds,
  );
}

export function buildPreviewSegmentIndex(
  paragraphText: string,
  candidates: readonly PreviewSegmentCandidate[],
  scopeIndex: number,
  paragraphIndex: number,
): PreviewSegmentIndex {
  const normalizedParagraph =
    paragraphText.length === 0 ? null : normalizeForMatching(paragraphText);

  return {
    paragraphText,
    scopeIndex,
    paragraphIndex,
    candidates: candidates.map((candidate, order): PreviewCandidateMarks => {
      const rawMarks = findRawMarks(paragraphText, candidate, order);
      const fallbackMarks =
        normalizedParagraph === null
          ? []
          : findNormalizedMarks(
              paragraphText,
              normalizedParagraph,
              candidate,
              order,
            );
      return {
        selectionTargetId: candidate.selectionTargetId,
        text: candidate.text,
        order,
        rawMarks,
        fallbackMarks,
      };
    }),
  };
}

export function resolvePreviewSegments(
  index: PreviewSegmentIndex,
  selectedIds: ReadonlySet<string>,
): PreviewSegment[] {
  const selectedCandidates = index.candidates.filter((candidate) =>
    selectedIds.has(candidate.selectionTargetId),
  );
  const uncheckedCandidates = index.candidates.filter(
    (candidate) => !selectedIds.has(candidate.selectionTargetId),
  );
  const selectedMarks = findMarksFromIndex(selectedCandidates);
  const uncheckedMarks = findMarksFromIndex(uncheckedCandidates).filter(
    (span) => !selectedMarks.some((selected) => overlaps(span, selected)),
  );
  const marks = [...selectedMarks, ...uncheckedMarks].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    const lengthDiff = b.end - b.start - (a.end - a.start);
    if (lengthDiff !== 0) return lengthDiff;
    return a.order - b.order;
  });
  if (marks.length === 0) {
    return [
      {
        type: "text",
        key: `${index.scopeIndex}-${index.paragraphIndex}-text-0`,
        text: index.paragraphText,
      },
    ];
  }

  const segments: PreviewSegment[] = [];
  let cursor = 0;
  let segmentIndex = 0;

  for (const mark of marks) {
    if (mark.start > cursor) {
      segments.push({
        type: "text",
        key: `${index.scopeIndex}-${index.paragraphIndex}-text-${segmentIndex}`,
        text: index.paragraphText.slice(cursor, mark.start),
      });
      segmentIndex += 1;
    }

    segments.push({
      type: "mark",
      key: `${index.scopeIndex}-${index.paragraphIndex}-mark-${segmentIndex}`,
      text: mark.text,
      selectionTargetId: mark.selectionTargetId,
      candidate: mark.candidate,
      selected: selectedIds.has(mark.selectionTargetId),
    });
    segmentIndex += 1;
    cursor = mark.end;
  }

  if (cursor < index.paragraphText.length) {
    segments.push({
      type: "text",
      key: `${index.scopeIndex}-${index.paragraphIndex}-text-${segmentIndex}`,
      text: index.paragraphText.slice(cursor),
    });
  }

  return segments;
}

function findMarksFromIndex(
  candidates: readonly PreviewCandidateMarks[],
): PreviewMarkSpan[] {
  const primary = resolveOverlaps(
    candidates.flatMap((candidate) => candidate.rawMarks),
  );
  const matchedCandidates = new Set(
    primary.map((span) => span.selectionTargetId),
  );
  const remaining = candidates.filter(
    (candidate) => !matchedCandidates.has(candidate.selectionTargetId),
  );
  if (remaining.length === 0) return primary;

  const fallback = remaining.flatMap((candidate) => candidate.fallbackMarks);

  return resolveOverlaps([...primary, ...fallback]);
}

function findRawMarks(
  paragraphText: string,
  candidate: PreviewSegmentCandidate,
  order: number,
): PreviewMarkSpan[] {
  const spans: PreviewMarkSpan[] = [];

  if (candidate.text.length === 0) return spans;

  let from = 0;
  while (from <= paragraphText.length - candidate.text.length) {
    const start = paragraphText.indexOf(candidate.text, from);
    if (start < 0) break;

    spans.push({
      start,
      end: start + candidate.text.length,
      text: candidate.text,
      selectionTargetId: candidate.selectionTargetId,
      candidate: candidate.text,
      order,
    });
    from = start + 1;
  }

  return spans;
}

function findNormalizedMarks(
  paragraphText: string,
  normalizedParagraph: ReturnType<typeof normalizeForMatching>,
  candidate: PreviewSegmentCandidate,
  order: number,
): PreviewMarkSpan[] {
  const normalizedCandidate = normalizeForMatching(candidate.text).text;
  if (normalizedCandidate.length === 0) return [];

  const spans: PreviewMarkSpan[] = [];
  let from = 0;
  while (from <= normalizedParagraph.text.length - normalizedCandidate.length) {
    const idx = normalizedParagraph.text.indexOf(normalizedCandidate, from);
    if (idx < 0) break;

    const start = normalizedParagraph.origOffsets[idx];
    const end = normalizedParagraph.origOffsets[idx + normalizedCandidate.length];
    if (start === undefined || end === undefined) break;

    spans.push({
      start,
      end,
      text: paragraphText.slice(start, end),
      selectionTargetId: candidate.selectionTargetId,
      candidate: candidate.text,
      order,
    });
    from = idx + 1;
  }

  return spans;
}

function resolveOverlaps(spans: readonly PreviewMarkSpan[]): PreviewMarkSpan[] {
  const sorted = [...spans].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    const lengthDiff = b.end - b.start - (a.end - a.start);
    if (lengthDiff !== 0) return lengthDiff;
    return a.order - b.order;
  });

  const kept: PreviewMarkSpan[] = [];
  let cursor = 0;

  for (const span of sorted) {
    if (span.start < cursor) continue;
    kept.push(span);
    cursor = span.end;
  }

  return kept;
}

function overlaps(a: PreviewMarkSpan, b: PreviewMarkSpan): boolean {
  return a.start < b.end && b.start < a.end;
}
