<script lang="ts">
  import { tick } from "svelte";

  import { normalizeForMatching } from "../detection/normalize.js";
  import type { RenderedDocument } from "../docx/render-body.js";
  import type { Scope } from "../docx/types.js";
  import type { Analysis } from "./engine.js";
  import { appState } from "./state.svelte.ts";

  type Props = {
    renderedDoc: RenderedDocument;
    analysis: Analysis;
  };

  interface MarkSpan {
    readonly start: number;
    readonly end: number;
    readonly text: string;
    readonly candidate: string;
  }

  type Segment =
    | { readonly type: "text"; readonly key: string; readonly text: string }
    | {
        readonly type: "mark";
        readonly key: string;
        readonly text: string;
        readonly candidate: string;
      };

  type ParagraphView = {
    readonly key: string;
    readonly empty: boolean;
    readonly segments: readonly Segment[];
  };

  type ScopeView = {
    readonly key: string;
    readonly label: string;
    readonly empty: boolean;
    readonly paragraphs: readonly ParagraphView[];
  };

  let { renderedDoc, analysis }: Props = $props();

  let containerRef = $state<HTMLDivElement | null>(null);

  let allCandidates = $derived.by(() => {
    const candidates = new Set<string>();

    for (const group of analysis.entityGroups) {
      for (const literal of group.literals) {
        candidates.add(literal.text);
      }
    }

    for (const pii of analysis.piiCandidates) {
      candidates.add(pii.text);
    }

    for (const candidate of analysis.nonPiiCandidates) {
      candidates.add(candidate.text);
    }

    for (const bucket of appState.manualAdditions.values()) {
      for (const text of bucket) {
        candidates.add(text);
      }
    }

    return [...candidates].sort(
      (a, b) => b.length - a.length || a.localeCompare(b),
    );
  });

  let scopeViews = $derived.by(() =>
    renderedDoc.scopes.map((scope, scopeIndex): ScopeView => ({
      key: `${scopeIndex}-${scope.scope.path}`,
      label: scopeLabel(scope.scope),
      empty: scope.paragraphs.length === 0,
      paragraphs: scope.paragraphs.map((paragraph): ParagraphView => ({
        key: `${scopeIndex}-${paragraph.scopeIndex}`,
        empty: paragraph.text.length === 0,
        segments:
          paragraph.text.length === 0
            ? []
            : buildSegments(
                paragraph.text,
                allCandidates,
                scopeIndex,
                paragraph.scopeIndex,
              ),
      })),
    })),
  );

  $effect(() => {
    const focused = appState.focusedCandidate;
    const container = containerRef;
    if (!focused || container === null) return;

    let cancelled = false;
    let mark: HTMLElement | null = null;
    let pulseTimer: ReturnType<typeof setTimeout> | null = null;

    void tick().then(() => {
      if (cancelled || containerRef === null) return;
      mark = containerRef.querySelector<HTMLElement>(
        `mark[data-text="${cssEscape(focused)}"]`,
      );
      if (mark === null) return;
      mark.scrollIntoView({ block: "center", behavior: "smooth" });
      mark.classList.add("pulse");
      pulseTimer = setTimeout(() => {
        mark?.classList.remove("pulse");
      }, 1200);
    });

    return () => {
      cancelled = true;
      if (pulseTimer !== null) {
        clearTimeout(pulseTimer);
      }
      mark?.classList.remove("pulse");
    };
  });

  function scopeLabel(scope: Scope): string {
    switch (scope.kind) {
      case "body":
        return "본문";
      case "header":
        return `머리글 ${scopeNumber(scope)}`.trim();
      case "footer":
        return `바닥글 ${scopeNumber(scope)}`.trim();
      case "footnotes":
        return "각주";
      case "endnotes":
        return "미주";
      case "comments":
        return "메모";
    }
  }

  function scopeNumber(scope: Scope): string {
    const match = /(\d+)\.xml$/.exec(scope.path);
    return match?.[1] ?? "";
  }

  function buildSegments(
    paragraphText: string,
    candidates: readonly string[],
    scopeIndex: number,
    paragraphIndex: number,
  ): Segment[] {
    const marks = findMarksWithFallback(paragraphText, candidates);
    if (marks.length === 0) {
      return [
        {
          type: "text",
          key: `${scopeIndex}-${paragraphIndex}-text-0`,
          text: paragraphText,
        },
      ];
    }

    const segments: Segment[] = [];
    let cursor = 0;
    let segmentIndex = 0;

    for (const mark of marks) {
      if (mark.start > cursor) {
        segments.push({
          type: "text",
          key: `${scopeIndex}-${paragraphIndex}-text-${segmentIndex}`,
          text: paragraphText.slice(cursor, mark.start),
        });
        segmentIndex += 1;
      }

      segments.push({
        type: "mark",
        key: `${scopeIndex}-${paragraphIndex}-mark-${segmentIndex}`,
        text: mark.text,
        candidate: mark.candidate,
      });
      segmentIndex += 1;
      cursor = mark.end;
    }

    if (cursor < paragraphText.length) {
      segments.push({
        type: "text",
        key: `${scopeIndex}-${paragraphIndex}-text-${segmentIndex}`,
        text: paragraphText.slice(cursor),
      });
    }

    return segments;
  }

  function findMarksWithFallback(
    paragraphText: string,
    candidates: readonly string[],
  ): MarkSpan[] {
    const primary = resolveOverlaps(findRawMarks(paragraphText, candidates));
    const matchedCandidates = new Set(primary.map((span) => span.candidate));
    const remaining = candidates.filter((candidate) => !matchedCandidates.has(candidate));
    if (remaining.length === 0) return primary;

    const normalizedParagraph = normalizeForMatching(paragraphText);
    const fallback: MarkSpan[] = [];

    for (const candidate of remaining) {
      const normalizedCandidate = normalizeForMatching(candidate).text;
      if (normalizedCandidate.length === 0) continue;

      let from = 0;
      while (from <= normalizedParagraph.text.length - normalizedCandidate.length) {
        const idx = normalizedParagraph.text.indexOf(normalizedCandidate, from);
        if (idx < 0) break;

        const start = normalizedParagraph.origOffsets[idx];
        const end = normalizedParagraph.origOffsets[idx + normalizedCandidate.length];
        if (start === undefined || end === undefined) break;

        fallback.push({
          start,
          end,
          text: paragraphText.slice(start, end),
          candidate,
        });
        from = idx + 1;
      }
    }

    return resolveOverlaps([...primary, ...fallback]);
  }

  function findRawMarks(
    paragraphText: string,
    candidates: readonly string[],
  ): MarkSpan[] {
    const spans: MarkSpan[] = [];

    for (const candidate of candidates) {
      if (candidate.length === 0) continue;

      let from = 0;
      while (from <= paragraphText.length - candidate.length) {
        const start = paragraphText.indexOf(candidate, from);
        if (start < 0) break;

        spans.push({
          start,
          end: start + candidate.length,
          text: candidate,
          candidate,
        });
        from = start + 1;
      }
    }

    return spans;
  }

  function resolveOverlaps(spans: readonly MarkSpan[]): MarkSpan[] {
    const sorted = [...spans].sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      return b.end - b.start - (a.end - a.start);
    });

    const kept: MarkSpan[] = [];
    let cursor = 0;

    for (const span of sorted) {
      if (span.start < cursor) continue;
      kept.push(span);
      cursor = span.end;
    }

    return kept;
  }

  function cssEscape(text: string): string {
    return text.replace(/["\\]/g, "\\$&");
  }
</script>

<div class="doc-body" bind:this={containerRef}>
  {#each scopeViews as scope (scope.key)}
    <section class="scope-block">
      <h3 class="scope-label">{scope.label}</h3>
      {#if scope.empty}
        <p class="scope-empty">(비어 있음)</p>
      {:else}
        {#each scope.paragraphs as paragraph (paragraph.key)}
          {#if paragraph.empty}
            <p class="para empty">&nbsp;</p>
          {:else}
            <p class="para">
              {#each paragraph.segments as segment (segment.key)}
                {#if segment.type === "text"}
                  {segment.text}
                {:else}
                  <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
                  <mark
                    class="cand-mark"
                    class:checked={appState.isSelected(segment.candidate)}
                    class:unchecked={!appState.isSelected(segment.candidate)}
                    data-text={segment.candidate}
                    data-candidate={segment.candidate}
                    tabindex="0"
                    role="button"
                    aria-pressed={appState.isSelected(segment.candidate)}
                    aria-label={`Toggle redaction for ${segment.candidate}`}
                    onclick={() => appState.toggleSelection(segment.candidate)}
                    onkeydown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        appState.toggleSelection(segment.candidate);
                      }
                    }}
                  >
                    {segment.text}
                  </mark>
                {/if}
              {/each}
            </p>
          {/if}
        {/each}
      {/if}
    </section>
  {/each}
</div>

<style>
  .doc-body {
    max-height: 70vh;
    overflow-y: auto;
    padding: 16px 20px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
    line-height: 1.6;
    font-size: 13.5px;
    color: var(--ink);
  }

  .scope-block + .scope-block {
    margin-top: 20px;
  }

  .scope-label {
    margin: 0 0 8px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--border);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }

  .scope-empty {
    margin: 0;
    color: var(--ink-muted);
    font-style: italic;
  }

  .para {
    margin: 0 0 8px;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .para.empty {
    min-height: 1em;
  }

  .cand-mark {
    border: 1px solid transparent;
    border-radius: 3px;
    padding: 0 2px;
    cursor: pointer;
    transition:
      background 0.12s ease,
      border-color 0.12s ease,
      box-shadow 0.12s ease,
      color 0.12s ease;
    outline-offset: 2px;
  }

  .cand-mark:hover {
    background: var(--mark);
  }

  .cand-mark.checked {
    background: var(--mark-strong);
    box-shadow: 0 0 0 2px #f59e0b;
    color: var(--ink);
  }

  .cand-mark.unchecked {
    background: transparent;
    border-style: dashed;
    border-color: var(--border-strong);
    color: var(--ink-soft);
  }

  .cand-mark:focus-visible {
    outline: 2px solid var(--primary);
  }

  :global(.cand-mark.pulse) {
    animation: pulse 1.2s ease;
  }

  @keyframes pulse {
    0% {
      box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.5);
    }

    50% {
      box-shadow: 0 0 0 6px rgba(245, 158, 11, 0);
    }

    100% {
      box-shadow: 0 0 0 0 rgba(245, 158, 11, 0);
    }
  }
</style>
