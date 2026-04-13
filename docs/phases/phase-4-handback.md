# Phase 4 handback — Field / hyperlink leak vectors

**Completed:** 2026-04-13 14:27 KST
**Executed by:** Codex 5.4 xhigh
**Starting commit:** `6786739`
**Ending commit:** `8721ffb` (code-complete HEAD before this handback commit)

## Summary

Phase 4 closed the field/hyperlink leak vector with a two-layer docx-only fix: a new `flatten-fields.ts` pre-pass strips `<w:fldChar>`, `<w:instrText>`, `<w:fldSimple>`, and `<w:hyperlink>` wrappers before redaction runs; `redact.ts` now includes an `instrText`/`w:instr` safety-net scrub in case malformed field XML survives flattening; and `verify.ts` now scans `.rels` files so orphaned hyperlink targets are treated as real survivals and block download. The suite grew from 1562 to 1600 passing tests (+38), with an end-to-end synthetic rels case proving the exact leak path is now detectable at the public `redactDocx()` seam.

## Commits created

```text
8721ffb test(docx): add end-to-end field-leak integration test on synthetic zip
86dff21 feat(docx/verify): scan rels files for surviving sensitive strings
703dfb8 feat(docx/redact-docx): insert flattenFieldsInZip pass after strip-comments
4671c31 feat(docx/redact): add instrText safety-net scrub in redactScopeXml
bbd2859 feat(docx): add flatten-fields module — strip fields and unwrap hyperlinks
```

## Files created

- `src/docx/flatten-fields.ts` (60 lines)
- `src/docx/flatten-fields.test.ts` (246 lines)
- `docs/phases/phase-4-handback.md`

## Files modified

- `src/docx/redact.ts` (+`redactInstrText`, `redactScopeXml` safety-net pass; 329 lines total)
- `src/docx/redact.test.ts` (+11 tests, 429 lines total)
- `src/docx/redact-docx.ts` (pipeline split to insert `flattenFieldsInZip`; 134 lines total)
- `src/docx/redact-docx.test.ts` (+4 integration tests, 326 lines total)
- `src/docx/verify.ts` (+rels scan + path enumeration, 146 lines total)
- `src/docx/verify.test.ts` (+5 rels-scan tests, 243 lines total)
- `src/docx/types.ts` (unchanged; runtime `rels` scope uses an explicit synthetic cast in `verify.ts`)

## Tests

- Before: 1562 passing
- After: 1600 passing
- New: +38 tests

Breakdown:
- `flatten-fields.test.ts`: +18
- `redact.test.ts`: +11
- `redact-docx.test.ts`: +4
- `verify.test.ts`: +5

## Build

- Before hash (last recorded pre-Phase-4 handback hash): `626db003a5b2e946176d7966e5e22107a960359b17790e4105c76bd90cac41d2`
- After hash (Phase 4): `9a04a14f2be2f94b9ffb8d564ceba16d181b513145221f9e1c4827b438b7c66c`
- Determinism: yes

## Acceptance criteria

1. ✅ `bun run test` passed `1600 passed (1600)` with 0 failures.
2. ✅ `bun run typecheck` passed with `0 errors` and `0 warnings`.
3. ✅ `bun run lint` reported 0 errors; only the same 3 pre-existing `coverage/*.js` warnings remain.
4. ✅ `bun run build` succeeded, and two sequential builds produced the same sha256 `9a04a14f2be2f94b9ffb8d564ceba16d181b513145221f9e1c4827b438b7c66c`.
5. ✅ Phase 0 characterization still passes: `src/detection/detect-pii.characterization.test.ts` → `24 passed`.
6. ✅ `src/docx/flatten-fields.ts` exports `flattenFields` and `flattenFieldsInZip`.
7. ✅ `src/docx/flatten-fields.test.ts` has 18 passing tests.
8. ✅ `src/docx/redact.ts` exports `redactInstrText` and `redactScopeXml` now invokes it after paragraph redaction.
9. ✅ `src/docx/redact.test.ts` now includes 11 additional Phase 4 tests and passes `48/48`.
10. ✅ `src/docx/redact-docx.ts` calls `flattenFieldsInZip` between comment dropping and the redaction scope walk.
11. ✅ `src/docx/verify.ts` now scans `.rels` files, including `word/_rels/*.rels` and root `_rels/.rels`.
12. ✅ `src/docx/verify.test.ts` has 5 new rels-focused tests and passes `19/19`.
13. ✅ `flattenFields` is idempotent; covered in both unit and zip-level tests.
14. ✅ `redactInstrText` is idempotent; covered directly in `redact.test.ts` and indirectly via `redactScopeXml`.
15. ✅ End-to-end synthetic zip with hyperlink display + orphaned rel now returns `verify.isClean === false`; covered by `redactDocx — Phase 4 field/hyperlink integration > flags the orphaned hyperlink rel as a verify failure end-to-end`.
16. ✅ Locked layers are unchanged: `git diff --stat 6786739 -- src/detection src/propagation src/finalize src/ui` is empty.
17. ✅ Locked docx files are unchanged: `coalesce.ts`, `scopes.ts`, `flatten-track-changes.ts`, `strip-comments.ts`, `scrub-metadata.ts`, and `render-body.ts` diff clean against `6786739`.
18. ✅ No new npm dependencies were added.
19. ✅ No `try` appears in `src/docx/flatten-fields.ts`, `src/docx/redact.ts`, or `src/docx/verify.ts`.
20. ✅ No network code appears in the new/modified production docx files.
21. ✅ Phase 4 produced 5 local code commits from `6786739..8721ffb`; with this handback commit it reaches 6 conventional local commits, all with `Co-Authored-By: Codex <noreply@openai.com>`.
22. ✅ This handback document exists at `docs/phases/phase-4-handback.md`.
23. ⚠️ Manual browser verification on the actual pearlabyss document was not executed in this CLI-only session; the synthetic end-to-end hyperlink/rel test now covers the same leak shape programmatically.

## Deviations from brief

- The final suite landed at `1600` passing tests instead of the brief's approximate `1595+` because the Phase 4 additions totaled +38 tests and the optional Step 8 end-to-end regression was included.
- `src/docx/types.ts` was intentionally left unchanged. Instead of introducing a new `"rels"` discriminator into the shared `ScopeKind` union and rippling that into locked UI code, `verify.ts` emits the synthetic rels scope with an explicit `unknown as Scope` cast while preserving the runtime `scope.kind === "rels"` shape the verifier surfaces.
- `redact-docx.ts` needed a small structural split rather than a literal one-line insertion because the current orchestrator flattened track changes, stripped comment refs, and redacted in the same loop. The final version preserves the locked order semantically: flatten/strip first, drop comments, flatten fields, then redact.

## Gotchas encountered

- The first draft of the field-run regex over-matched across sibling runs and ate visible text outside the field. Tightening the `fldChar` and `instrText` patterns to stay within a single `<w:r>...</w:r>` fixed that without abandoning the brief’s regex-based approach.
- TypeScript correctly objected to casting `{ kind: "rels" }` straight to `Scope`; the explicit `unknown as Scope` form was required.
- `dist/document-redactor.html.sha256` can drift during long sessions because other verification steps also trigger builds. The final hash recorded above came from a clean sequential determinism rerun.

## Manual verification recommended

- [ ] Open `dist/document-redactor.html`.
- [ ] Drop the pearlabyss contract or another DOCX with HYPERLINK fields pointing to an email address.
- [ ] Check the email candidate and click Apply.
- [ ] Confirm the in-body display text is redacted.
- [ ] Confirm either:
- [ ] No survival report appears because the source had no URL-bearing rel left, or
- [ ] The survival report now points at a rels path such as `word/_rels/document.xml.rels`, making the remaining leak explicit instead of silent.

## Suggested next steps

1. Implement full rels scrubbing so orphaned hyperlink `Target` values are removed or sanitized instead of only detected.
2. Extend the same paranoid docx hygiene to other deferred leak vectors: hidden text, embedded OLE, image EXIF, and revision IDs.
3. Add structured-document-tag (`<w:sdt>`) handling if real contracts contain bound content controls.
4. Add browser automation around the verify-fail banner so the new rels-path UX can be asserted outside CLI-only tests.
