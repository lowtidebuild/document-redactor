<!--
  Right panel — category-grouped review UI for the Phase 1 candidate tree.

  Authoritative structural reference from session-log-2026-04-11-v2
  ("Finding 1.3 — user insight"):

  ┌─────────────────────────────────────┐
  │  자동 감지됨 (Auto-detected)          │
  │  ┌────────────┬─────────────────┐   │
  │  │ 당사자       │ [✓] ABC 주식회사  │   │
  │  │            │ [✓] 대표이사 김철수 │   │
  │  │            │ [+ 추가]         │   │
  │  ├────────────┼─────────────────┤   │
  │  │ 식별번호     │ [✓] 123-45-67890│   │
  │  │ (PII)      │ [✓] 12-3456789  │   │
  │  ├────────────┼─────────────────┤   │
  │  │ 금액        │ [✓] 50,000,000원│   │
  │  │            │ [✓] USD 50,000  │   │
  │  │            │ [+ 추가]         │   │
  │  ├────────────┼─────────────────┤   │
  │  │ 날짜 / 기간  │ [✓] 2024년 3월 15일│ │
  │  │            │ [✓] 3년간        │   │
  │  │            │ [+ 추가]         │   │
  │  ├────────────┼─────────────────┤   │
  │  │ 법원 / 사건  │ [ ] 서울중앙지방법원 │ │
  │  │            │ [ ] 2023가합12345│   │
  │  ├────────────┼─────────────────┤   │
  │  │ 추측 (낮은   │ [ ] "Project Alpha"│ │
  │  │ 신뢰도)     │ [ ] XYZ Company │   │
  │  └────────────┴─────────────────┘   │
  │  [+ 누락된 항목 직접 추가]              │
  └─────────────────────────────────────┘
-->
<script lang="ts">
  import CategorySection from "./CategorySection.svelte";
  import type { Analysis, PiiCandidate } from "./engine.ts";
  import { appState, type AppPhase } from "./state.svelte.ts";
  import type { ManualCategory } from "./state.svelte.ts";

  type CategoryCandidate = {
    text: string;
    meta: string;
    confidence?: number | undefined;
    isManual: boolean;
    manualCategory?: ManualCategory | undefined;
  };

  type PanelSections = {
    literals: CategoryCandidate[];
    defined: CategoryCandidate[];
    pii: CategoryCandidate[];
    financial: CategoryCandidate[];
    temporal: CategoryCandidate[];
    entities: CategoryCandidate[];
    legal: CategoryCandidate[];
    heuristics: CategoryCandidate[];
  };

  type Props = {
    phase: AppPhase;
  };

  let { phase }: Props = $props();

  const EMPTY_SECTIONS: PanelSections = {
    literals: [],
    defined: [],
    pii: [],
    financial: [],
    temporal: [],
    entities: [],
    legal: [],
    heuristics: [],
  };

  let selectedCount = $derived(appState.selections.size);

  let sections = $derived.by(() => {
    if (phase.kind !== "postParse") return EMPTY_SECTIONS;
    return buildSections(phase.analysis);
  });

  let totalCount = $derived(
    sections.literals.length +
      sections.defined.length +
      sections.pii.length +
      sections.financial.length +
      sections.temporal.length +
      sections.entities.length +
      sections.legal.length +
      sections.heuristics.length,
  );

  let canApply = $derived(
    phase.kind === "postParse" && selectedCount > 0,
  );

  function piiKindLabel(kind: PiiCandidate["kind"]): string {
    switch (kind) {
      case "rrn":
        return "주민등록번호";
      case "brn":
        return "사업자등록번호";
      case "ein":
        return "US EIN";
      case "phone-kr":
        return "phone · KR";
      case "phone-intl":
        return "phone · intl";
      case "email":
        return "email";
      case "account-kr":
        return "bank account · KR";
      case "card":
        return "credit card";
    }
  }

  function formatScopes(
    scopes: ReadonlyArray<{ kind: string; path: string }>,
  ): string {
    const kinds = new Set(scopes.map((scope) => scope.kind));
    return [...kinds].join(" · ");
  }

  function ruleSubcategory(ruleId: string): string {
    const [, subcategory = ruleId] = ruleId.split(".", 2);
    return subcategory;
  }

  function pushUnique(
    out: CategoryCandidate[],
    seen: Set<string>,
    candidate: CategoryCandidate,
  ): void {
    if (seen.has(candidate.text)) return;
    seen.add(candidate.text);
    out.push(candidate);
  }

  function appendManualCandidates(
    out: CategoryCandidate[],
    seen: Set<string>,
    category: ManualCategory,
  ): void {
    const bucket = appState.manualAdditions.get(category);
    if (bucket === undefined) return;
    for (const text of bucket) {
      pushUnique(out, seen, {
        text,
        meta: "manual",
        isManual: true,
        manualCategory: category,
      });
    }
  }

  function buildLiteralCandidates(
    analysis: Analysis,
    seen: Set<string>,
  ): CategoryCandidate[] {
    const out: CategoryCandidate[] = [];
    for (const group of analysis.entityGroups) {
      for (const candidate of group.literals) {
        pushUnique(out, seen, {
          text: candidate.text,
          meta: `literal · ${group.seed}`,
          isManual: false,
        });
      }
    }
    appendManualCandidates(out, seen, "literals");
    return out;
  }

  function buildDefinedCandidates(
    analysis: Analysis,
    seen: Set<string>,
  ): CategoryCandidate[] {
    const out: CategoryCandidate[] = [];
    for (const group of analysis.entityGroups) {
      for (const candidate of group.defined) {
        pushUnique(out, seen, {
          text: candidate.text,
          meta: `from definition · ${group.seed}`,
          isManual: false,
        });
      }
    }
    return out;
  }

  function buildPiiCandidates(
    analysis: Analysis,
    seen: Set<string>,
  ): CategoryCandidate[] {
    const out: CategoryCandidate[] = [];
    for (const candidate of analysis.piiCandidates) {
      pushUnique(out, seen, {
        text: candidate.text,
        meta: `${piiKindLabel(candidate.kind)} · ${formatScopes(candidate.scopes)}`,
        isManual: false,
      });
    }
    return out;
  }

  function buildNonPiiCandidates(
    analysis: Analysis,
    seen: Set<string>,
    categories: ReadonlyArray<
      "financial" | "temporal" | "entities" | "structural" | "legal" | "heuristics"
    >,
    manualCategory?: ManualCategory,
  ): CategoryCandidate[] {
    const allowed = new Set(categories);
    const out: CategoryCandidate[] = [];

    for (const candidate of analysis.nonPiiCandidates) {
      if (!allowed.has(candidate.category)) continue;
      pushUnique(out, seen, {
        text: candidate.text,
        meta: `${ruleSubcategory(candidate.ruleId)} · ${formatScopes(candidate.scopes)}`,
        confidence: candidate.confidence,
        isManual: false,
      });
    }

    if (manualCategory !== undefined) {
      appendManualCandidates(out, seen, manualCategory);
    }

    return out;
  }

  function buildSections(analysis: Analysis): PanelSections {
    const seen = new Set<string>();

    const literals = buildLiteralCandidates(analysis, seen);
    const defined = buildDefinedCandidates(analysis, seen);
    const pii = buildPiiCandidates(analysis, seen);
    const financial = buildNonPiiCandidates(
      analysis,
      seen,
      ["financial"],
      "financial",
    );
    const temporal = buildNonPiiCandidates(
      analysis,
      seen,
      ["temporal"],
      "temporal",
    );
    const entities = buildNonPiiCandidates(
      analysis,
      seen,
      ["entities", "structural"],
      "entities",
    );
    const legal = buildNonPiiCandidates(
      analysis,
      seen,
      ["legal"],
      "legal",
    );
    const heuristics = buildNonPiiCandidates(
      analysis,
      seen,
      ["heuristics"],
    );

    return {
      literals,
      defined,
      pii,
      financial,
      temporal,
      entities,
      legal,
      heuristics,
    };
  }
</script>

<aside class="panel">
  {#if phase.kind === "postParse"}
    <div class="panel-head">
      <h2 class="panel-title">Candidates</h2>
      <p class="panel-sub">
        Review every string before redaction. Categories below.
      </p>
    </div>

    <div class="panel-body">
      <CategorySection
        label="당사자"
        subHint="Auto-selected · 자동 선택됨"
        category="literals"
        candidates={sections.literals}
        canManualAdd={true}
      />

      <CategorySection
        label="정의된 대리어"
        subHint="Kept as-is by default (D9 정책 — 독해성 유지)"
        category="defined"
        candidates={sections.defined}
        canManualAdd={false}
      />

      <CategorySection
        label="식별번호 (PII)"
        subHint="주민번호 · 사업자번호 · 이메일 · 계좌 — 자동 검출"
        category="pii"
        candidates={sections.pii}
        canManualAdd={false}
      />

      <CategorySection
        label="금액"
        subHint="한화 · USD · 외화 · 백분율 — Phase 1 financial rules"
        category="financial"
        candidates={sections.financial}
        canManualAdd={true}
      />

      <CategorySection
        label="날짜 / 기간"
        subHint="한국식 · ISO · 영문 · 기간 — Phase 1 temporal rules"
        category="temporal"
        candidates={sections.temporal}
        canManualAdd={true}
      />

      <CategorySection
        label="법인 / 인물"
        subHint="주식회사 · 대표이사 · 서명자 — Phase 1 entities + structural"
        category="entities"
        candidates={sections.entities}
        canManualAdd={true}
      />

      <CategorySection
        label="법원 / 사건"
        subHint="사건번호 · 법원명 · 법령 · 판례 — Phase 1 legal rules"
        category="legal"
        candidates={sections.legal}
        canManualAdd={true}
      />

      <CategorySection
        label="추측 (낮은 신뢰도)"
        subHint="휴리스틱 감지 — 검토 후 체크하세요"
        category="heuristics"
        candidates={sections.heuristics}
        canManualAdd={false}
        warnStyle={true}
      />
    </div>

    <div class="panel-foot">
      <div class="summary-row">
        <span>Selected</span>
        <strong>{selectedCount} of {totalCount}</strong>
      </div>
      <button
        class="btn-apply"
        type="button"
        disabled={!canApply}
        onclick={() => void appState.applyNow()}
      >
        Apply and verify
      </button>
      <div class="shortcut-hint">⌘↵ apply · drop file to start over</div>
    </div>
  {:else if phase.kind === "idle"}
    <div class="panel-head">
      <h2 class="panel-title">Candidates</h2>
      <p class="panel-sub">
        Drop a file on the left to start. You'll see every sensitive
        string we detected here, grouped and reviewable before redaction.
      </p>
    </div>
  {:else if phase.kind === "parsing"}
    <div class="panel-head">
      <h2 class="panel-title">Candidates</h2>
      <p class="panel-sub">Analyzing…</p>
    </div>
  {:else if phase.kind === "redacting"}
    <div class="panel-head">
      <h2 class="panel-title">Redacting…</h2>
      <p class="panel-sub">
        Cross-run substitution, metadata scrub, round-trip verify.
      </p>
    </div>
  {:else if phase.kind === "downloadReady"}
    <div class="panel-head">
      <h2 class="panel-title" style="color: var(--ok)">Ready to download</h2>
      <p class="panel-sub">
        {phase.report.scopeMutations.length} scopes touched ·
        0 leaks
      </p>
    </div>
  {:else if phase.kind === "verifyFail"}
    <div class="panel-head">
      <h2 class="panel-title" style="color: var(--err)">
        Verification failed
      </h2>
      <p class="panel-sub">
        Download blocked. Review survivals in the main panel.
      </p>
    </div>
  {:else if phase.kind === "fatalError"}
    <div class="panel-head">
      <h2 class="panel-title">Error</h2>
      <p class="panel-sub">See the main panel for details.</p>
    </div>
  {/if}
</aside>

<style>
  .panel {
    border-left: 1px solid var(--border);
    background: var(--surface);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    grid-row: 2;
  }

  .panel-head {
    padding: 20px 20px 14px;
    border-bottom: 1px solid var(--border);
  }

  .panel-title {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: -0.015em;
    margin: 0;
    color: var(--ink-strong);
  }

  .panel-sub {
    font-size: 12px;
    color: var(--ink-soft);
    margin-top: 5px;
    line-height: 1.5;
  }

  .panel-body {
    flex: 1;
    overflow-y: auto;
    padding: 14px 20px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .panel-foot {
    padding: 18px 20px;
    border-top: 1px solid var(--border);
    background: var(--bg);
  }

  .summary-row {
    display: flex;
    justify-content: space-between;
    font-size: 12.5px;
    color: var(--ink-soft);
    margin-bottom: 7px;
  }

  .summary-row strong {
    color: var(--ink-strong);
    font-weight: 700;
    font-family: var(--mono);
  }

  .btn-apply {
    width: 100%;
    margin-top: 14px;
    padding: 12px 16px;
    background: var(--primary);
    color: #fff;
    border: 1px solid var(--primary);
    border-radius: var(--radius);
    font-weight: 600;
    font-size: 14px;
    letter-spacing: -0.005em;
    box-shadow: 0 1px 3px rgba(37, 99, 235, 0.35);
    transition:
      background 0.15s,
      transform 0.1s,
      box-shadow 0.15s;
  }

  .btn-apply:hover:not(:disabled) {
    background: var(--primary-hover);
    border-color: var(--primary-hover);
    box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
  }

  .btn-apply:active:not(:disabled) {
    transform: scale(0.98);
  }

  .btn-apply:disabled {
    background: var(--ink-muted);
    border-color: var(--ink-muted);
    box-shadow: none;
    cursor: not-allowed;
  }

  .shortcut-hint {
    font-size: 11px;
    color: var(--ink-muted);
    text-align: center;
    margin-top: 10px;
    font-family: var(--mono);
  }
</style>
