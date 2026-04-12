# Phase 2 handback — UI redesign (category-grouped candidates)

**Completed:** 2026-04-13 03:45 KST
**Executed by:** Codex 5.4
**Starting commit:** `753f66f`
**Ending commit:** `b3f54e2` (code-complete HEAD before this handback commit; the handback is committed separately per § 15 Step 10)

## Summary

Phase 2 is complete on top of the Phase 2 brief baseline at `753f66f`: the right-hand review panel now renders the Phase 1 candidate tree in 8 category-grouped sections, supports per-category inline manual additions where the brief allows them, persists manual additions across re-analysis through `state.svelte.ts`, and narrows `defaultSelections()` so heuristics stay unchecked by default while D9 remains intact. The phase added 3 UI components plus 1 tiny test-only shim module, modified 5 existing UI/test files, and raised the suite from 1539 to 1548 passing tests (+9).

## Category sections rendered

- 당사자 (entity literals) — default checked
- 정의된 대리어 — default UNCHECKED (D9)
- 식별번호 (PII) — default checked
- 금액 — default checked, manual-add enabled
- 날짜 / 기간 — default checked, manual-add enabled
- 법인 / 인물 — default checked, manual-add enabled (entities + structural merged)
- 법원 / 사건 — default checked, manual-add enabled
- 추측 (heuristics) — default UNCHECKED, warn-styled, no manual-add

## Commits created

```text
b3f54e2 refactor(ui): compact CandidatesPanel section orchestration
5e34f56 feat(ui): redesign CandidatesPanel postParse to 8 category-grouped sections
d736b34 feat(ui): add CategorySection.svelte — per-category block with rows + add affordance
6c1acc6 feat(ui): add AddCandidateInput.svelte — inline per-category manual-add form
205012d feat(ui): add CandidateRow.svelte — reusable candidate row component
5374ae1 test(ui): preload Svelte state shim for ship-gate state-flow tests
9d7879a test(ui): add manual-candidate integration tests to ship-gate
887c609 feat(ui/state): add manualAdditions map and addManual/removeManual verbs
ada5808 refactor(ui/engine): default-select only confidence=1.0 nonPii candidates
```

## Files created

- `src/ui/CandidateRow.svelte` (209 lines)
- `src/ui/AddCandidateInput.svelte` (227 lines)
- `src/ui/CategorySection.svelte` (130 lines)
- `tests/ui-state-shim.js` (8 lines)
- `docs/phases/phase-2-handback.md`

## Files modified

- `src/ui/CandidatesPanel.svelte` (rewrite: 509 → 420 lines, +227 / -316)
- `src/ui/state.svelte.ts` (extended: +63 / -1, 228 lines total)
- `src/ui/engine.ts` (defaultSelections body only: +3 / -1, 392 lines total)
- `src/ui/engine.test.ts` (+145 / -1, 426 lines total)
- `src/ui/ship-gate.test.ts` (+62 / -1, 189 lines total)

## Tests

- Before: 1539 passing
- After: 1548 passing
- New: +9 tests (5 engine + 4 ship-gate)

## Build

- Before hash (Phase 1): `c9e274cb01c250a9589db392ca6c20bc3b6a546e6de633920f81292cbdb399b6`
- After hash (Phase 2): `983ef68580ecf6762cdbb57efdac1cd08bf24816e194b04e6c1d9d39c7a75363`
- Determinism: yes

## Acceptance criteria

1. ✅ `bun run test` passed with `1548 passed (1548)` and 0 failures on `b3f54e2`.
2. ✅ `bun run typecheck` passed with `svelte-check found 0 errors and 0 warnings`.
3. ✅ `bun run lint` reported 0 errors; only the same 3 pre-existing `coverage/*.js` warnings remain.
4. ✅ `bun run build` succeeded and produced `dist/document-redactor.html` plus `dist/document-redactor.html.sha256`.
5. ✅ Build determinism verified: two sequential builds produced the same sha256 `983ef68580ecf6762cdbb57efdac1cd08bf24816e194b04e6c1d9d39c7a75363`.
6. ✅ `src/ui/CategorySection.svelte` exists.
7. ✅ `src/ui/CandidateRow.svelte` exists.
8. ✅ `src/ui/AddCandidateInput.svelte` exists.
9. ✅ `src/ui/CandidatesPanel.svelte` was fully rewritten and reduced from 509 to 420 lines; see deviation note for why it did not reach the brief’s idealized ~250-line target.
10. ✅ `src/ui/state.svelte.ts` exports `ManualCategory`.
11. ✅ `AppState` has `manualAdditions: Map<ManualCategory, Set<string>>`.
12. ✅ `AppState` has `addManualCandidate(category, text)`.
13. ✅ `AppState` has `removeManualCandidate(category, text)`.
14. ✅ `defaultSelections(analysis)` excludes non-PII candidates with `confidence < 1.0`.
15. ✅ `defaultSelections(analysis)` excludes defined term labels (D9 preserved).
16. ✅ Manual additions persist across `loadFile` calls; covered by `ship gate — manual candidate state flow > manualAdditions persist across re-analysis via loadFile`.
17. ✅ `reset()` clears `manualAdditions`; covered by `ship gate — manual candidate state flow > reset clears both selections and manualAdditions`.
18. ✅ `Analysis` shape is unchanged; `git diff 753f66f -- src/ui/engine.ts` only touched the `defaultSelections` body.
19. ✅ `NonPiiCandidate`, `PiiCandidate`, and `ApplyOptions` interfaces remain unchanged in `src/ui/engine.ts`.
20. ✅ `analyzeZip` and `applyRedaction` signatures remain unchanged.
21. ✅ `git diff --name-only 753f66f -- src/detection src/propagation src/docx src/finalize` is empty.
22. ✅ No `.svelte` file changed outside `CandidatesPanel.svelte` and the 3 new components.
23. ✅ No changes to `package.json`, `vite.config.ts`, `eslint.config.js`, `tsconfig.json`, or `svelte.config.js`.
24. ✅ No new npm dependencies were added.
25. ✅ `bun run test src/detection/detect-pii.characterization.test.ts` passed `24 passed (24)`.
26. ✅ `bun run test src/detection/detect-all.test.ts` and `src/detection/detect-all.integration.test.ts` passed `50 passed (50)` and `10 passed (10)`.
27. ✅ `rg -n '\btry\b' src/ui/CategorySection.svelte src/ui/CandidateRow.svelte src/ui/AddCandidateInput.svelte || echo clean` returned `clean`.
28. ✅ `rg -n 'fetch\|XMLHttpRequest\|WebSocket\|EventSource\|sendBeacon\|import\(' src/ui/*.svelte src/ui/*.ts | grep -v '\.test\.ts' | grep -v 'import type\|^import' || echo clean` returned `clean`.
29. ✅ The phase produced 10 local commits including this handback, all conventional and all with `Co-Authored-By: Codex <noreply@openai.com>`.
30. ✅ This handback document exists at `docs/phases/phase-2-handback.md`.

## Deviations from brief

- The brief’s prose alternates between “seven” grouped sections and the explicit taxonomy in § 7.1–§ 7.8, which yields 8 visible sections. The implementation follows the detailed taxonomy and Step 8 wording: 8 sections.
- `CandidatesPanel.svelte` was rewritten and materially reduced (509 → 420 lines), but not all the way to the brief’s idealized ~250-line target. The remaining bulk comes from keeping the section orchestration, top-of-file insight reference, and render-time dedupe logic local to the panel instead of pushing that logic into extra files outside the brief’s component budget.
- A tiny test-only preload module, `tests/ui-state-shim.js`, was added so `ship-gate.test.ts` could statically import the real `state.svelte.ts` under the current Node/Vitest setup. Without it, the Svelte rune `$state` is not available in that test environment before module evaluation.

## Gotchas encountered

- `exactOptionalPropertyTypes` is especially strict across Svelte component boundaries. `confidence`, `manualCategory`, and `warnStyle` all needed explicit `| undefined` widening where present-but-undefined props were forwarded between components.
- The heuristic/default-selection policy has a subtle overlap case: a low-confidence heuristic can surface the same literal text that already exists in a higher-confidence section. The final panel dedupes candidate text by render order so those heuristic duplicates do not appear as visually “checked” in the low-confidence section.
- Direct runtime import of `.svelte.ts` modules inside Vitest’s Node environment does not expose the rune globals early enough by default. The test shim solved that without changing production code or lint config.

## Manual verification recommended

- [ ] Open `dist/document-redactor.html` in a browser.
- [ ] Drop `tests/fixtures/bilingual_nda_worst_case.docx`.
- [ ] Verify the visible grouped sections render in the expected order and the heuristics section is warn-styled when present.
- [ ] Click `+ 추가` in the 금액 section, add `USD 1,000,000`, and verify it appears with a `manual` badge.
- [ ] Click `×` on the manual row and verify it disappears.
- [ ] Add it again, re-drop the same file, and verify the manual item persists across re-analysis.
- [ ] Verify heuristic candidates remain unchecked by default when they are not already claimed by a higher-priority section.

## Suggested next steps

1. Phase 3 — Heuristic tuning: measure the 4 heuristics against a broader real-contract corpus and recalibrate confidence thresholds plus blacklist vocabulary.
2. Phase 4 — Lane C consolidation: unify `propagation/defined-terms.ts` with `structural/definition-section.ts`.
3. Phase 5 — Korean NFD→NFC hardening: add pre-normalization for decomposed Hangul input.
4. UI polish: collapsible sections, keyboard shortcuts beyond Enter/Escape, and dark mode after the v1.1 grouped-review workflow is validated.
