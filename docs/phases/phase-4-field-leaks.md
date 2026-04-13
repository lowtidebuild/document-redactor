# Phase 4 — Field / hyperlink leak vectors (URL + instrText scrub)

> ✅ **READY FOR CODEX EXECUTION** ✅
>
> Authored 2026-04-13 after Phase 3 manual QA surfaced a concrete leak:
> `contact@pearlabyss.com` was detected and selected (yellow highlight), the
> user clicked Apply, but the round-trip verifier reported it survived ×1 in
> `word/document.xml`. Root cause: Word stored the email inside a **complex
> field instruction** (`<w:instrText>HYPERLINK "mailto:contact@pearlabyss.com"</w:instrText>`)
> which the current pipeline does NOT scan — detection sees only display
> `<w:t>` text, redactor replaces only `<w:t>` content, so the field
> instruction survives untouched and the verifier catches it.
>
> This brief specifies a two-layer fix:
>
>   - **Option C — `flatten-fields.ts` pre-pass** (primary fix). Strip all
>     field machinery (`<w:fldChar>`, `<w:instrText>`, `<w:fldSimple>`) and
>     unwrap hyperlinks BEFORE detection runs, so the downstream pipeline
>     sees only plain runs. Eliminates field-based leak vectors entirely.
>   - **Option A — `<w:instrText>` safety net in redact.ts** (belt-and-
>     suspenders). Even after flatten, if any instrText survives due to
>     exotic field shapes or corrupt input, a post-redact pass scrubs any
>     remaining sensitive string from instrText content.
>   - **Rels verifier extension** (defense in depth). Extend
>     `verify.ts` to also scan `word/_rels/*.rels` for sensitive strings
>     in `Target` attributes. Flatten unwraps hyperlinks, but orphaned rels
>     entries could still contain URLs — scanning catches that too.
>
> Scope is limited to field/hyperlink vectors. Other deferred Paranoid-mode
> vectors (embedded OLE, image EXIF, revision IDs, hidden text) remain out
> of scope for Phase 4.

---

**For:** Codex 5.4 xhigh
**Project:** document-redactor
**Branch:** `main`
**Starting commit:** Phase 3 handback HEAD + subsequent manual-QA fixes (`a58709c` or descendant)
**Working directory:** `/Users/kpsfamily/코딩 프로젝트/document-redactor`
**Date written:** 2026-04-13
**Author of brief:** Claude Opus 4.6 at user's request
**Predecessor:** `docs/phases/phase-3-inline-preview.md` + Phase 3 manual-QA fix commits

---

## 0. How to read this document

Self-contained execution spec. Read the whole thing before touching code. Every decision is locked. Your job is to execute, not to re-debate.

### Sections

0. How to read this document
1. Mission statement
2. Required reading
3. Invariants
4. Architecture (pipeline order + module responsibilities)
5. File layout
6. WordprocessingML field reference (simple / complex / hyperlink shapes with examples)
7. `flatten-fields.ts` specification (the primary fix)
8. Hyperlink unwrap + `word/_rels/*.rels` cleanup
9. `redact.ts` instrText safety net (belt-and-suspenders)
10. `verify.ts` extension — scan rels files for surviving URLs
11. Pipeline order in `redact-docx.ts`
12. Testing strategy
13. TDD sequence (9 steps)
14. Verification commands
15. Gotchas + out-of-scope + acceptance criteria + handback + error handling

### Decisions locked

| Ref | Decision | Rationale |
|---|---|---|
| **4.1** Two-layer fix (A+C) | Primary: flatten-fields pre-pass removes all field machinery BEFORE detection. Belt-and-suspenders: instrText scrub post-pass inside redact.ts, in case any instrText sneaks past flatten. | Defense in depth. Flatten is the clean fix; the scrub is a safety net against exotic/corrupt inputs. |
| **4.2** Flatten position in pipeline | After `flattenTrackChanges` and `dropCommentsPart`, BEFORE scope walking for detection and redaction. | Track changes and comments are flattened first because they ALSO can contain fields; ordering ensures the field flatten sees a clean text layer. |
| **4.3** What flatten does | Strip `<w:fldChar>` runs entirely. Strip `<w:instrText>` runs entirely (whole `<w:r>` wrapper). Unwrap `<w:fldSimple>` (keep inner). Unwrap `<w:hyperlink>` (keep inner). Do NOT remove orphaned rels entries. | Removing rels requires parsing + cross-file coordination. Leaving orphans is harmless for Word; the verifier's new rels scan catches any surviving URL. |
| **4.4** Complex-field display-only preservation | Complex fields: `<w:fldChar begin>` … `<w:instrText>...</w:instrText>` … `<w:fldChar separate/>` … `<w:t>display</w:t>` … `<w:fldChar end/>`. Flatten KEEPS the display portion (between `separate` and `end`) and drops the instruction portion + all fldChar markers. | Display text is what the user sees and what the detector picked up; preserving it keeps the document readable. The instruction is what leaks. |
| **4.5** Hyperlink rels strategy | Unwrap `<w:hyperlink>` but do NOT modify `word/_rels/*.rels`. Instead, extend `verify.ts` to also search rels files for surviving sensitive strings in `Target` attributes. If a URL with sensitive data survives, the verifier catches it and blocks download. | Modifying rels is error-prone (cross-file integrity). Verifier extension is cheaper and more robust. |
| **4.6** InstrText safety net | After the existing `<w:t>`-run-aware redaction in `redactScopeXml`, a second pass scrubs sensitive strings from any remaining `<w:instrText>...</w:instrText>` content AND `<w:fldSimple w:instr="...">` attributes. Placeholder-replace (not delete) to preserve XML structure. | If flatten somehow missed an instrText (corrupt fields, unusual Word versions), the scrub replaces the sensitive content before verify runs. |
| **4.7** No changes to `src/detection/`, `src/propagation/`, `src/ui/` | Phase 4 is docx-layer only. Detection sees the post-flatten XML same as today (with field machinery removed), so candidate lists are unchanged. UI needs no updates. | Isolation of concerns. |
| **4.8** No new npm dependencies | Zero `bun add` / `npm install`. | Consistent with all prior phases. |
| **4.9** Deterministic | Flatten is a pure string transformation. Same input → same output. Build determinism (Phase 1+) preserved. | Required by the SHA-256 ship badge. |
| **4.10** Tests required | ≥ 15 unit tests for flatten-fields (per field shape + edge cases). ≥ 3 integration tests end-to-end on fixture that exercises field leaks. ≥ 3 verify rels-scan tests. | Adequate coverage for a security-critical fix. |

---

## 1. Mission statement

Eliminate the "email-in-field-instruction" leak vector surfaced during Phase 3 manual QA. Implement a two-layer defense: (1) a `flatten-fields.ts` pre-pass that strips field machinery before detection runs, (2) an `<w:instrText>` safety-net scrub inside redact.ts, (3) extend `verify.ts` to also scan `word/_rels/*.rels` files for surviving sensitive strings. All three together guarantee that field instructions and hyperlink URL targets cannot carry sensitive data past the redactor, and that the verifier catches any that do.

**Zero detection behavior change.** Candidates emitted by `analyzeZip` on the worst-case fixture must remain byte-identical; flatten removes only field machinery, not display text. Detection sees the same `<w:t>` runs either way.

**Phase 0 characterization preserved.** `detect-pii.characterization.test.ts` T1–T24 must still pass byte-for-byte. If they don't, Phase 4 has regressed and must be fixed before proceeding.

Expected deliverables: **1 new module** (`src/docx/flatten-fields.ts`) + test file + **1 new function** in `redact.ts` (`redactInstrText`) + test extensions + **1 extension** to `verify.ts` (rels scan) + test extensions + **pipeline update** in `redact-docx.ts`. ~8–10 commits. Zero npm dependencies. Post-phase test count ~1590+ passing.

---

## 2. Required reading (in order)

1. **`docs/phases/phase-3-handback.md`** + any manual-QA fix commits after it — confirm the starting state.

2. **`src/docx/coalesce.ts`** — run coalescer. Understands `<w:r>` boundaries. Does NOT touch `<w:fldChar>`, `<w:instrText>`, `<w:hyperlink>` wrappers. After flatten, these are gone so coalesce is unchanged.

3. **`src/docx/redact.ts`** (200+ lines) — current `<w:t>`-only redaction via `coalesceParagraphRuns`. You will ADD `redactInstrText` (a post-pass) and call it from `redactScopeXml`.

4. **`src/docx/redact-docx.ts`** — top-level pipeline orchestrator. Order of passes. You will insert `flattenFields` after `flattenTrackChanges`/`dropCommentsPart` and before `redactScopeXml`.

5. **`src/docx/flatten-track-changes.ts`** — CLOSEST template for the new `flatten-fields.ts`. Pure string-in / string-out. Idempotent. No JSZip. Follow its structure and testing conventions.

6. **`src/docx/strip-comments.ts`** — zip-aware sibling pass. Shows the pattern for multi-part cleanup (comments + commentsExtended + commentsIds + people.xml). Phase 4's hyperlink unwrap is in-paragraph so it stays in flatten-fields (no zip coordination needed).

7. **`src/docx/verify.ts`** — round-trip verifier. Currently scans `listScopes` (body / headers / footers / footnotes / endnotes / comments). You will extend it to ALSO scan `word/_rels/document.xml.rels` and sibling rels files.

8. **`src/docx/scopes.ts`** — scope walker + rels reading pattern. Confirms `readScopeXml` exists; you will add a parallel `readRelsXml` helper or use JSZip directly.

9. **`tests/fixtures/bilingual_nda_worst_case.docx`** — the canonical fixture. Phase 4 tests may need a new fixture that exercises complex fields (or you can construct synthetic XML directly in tests without a .docx).

10. **`../document-redactor-private-notes/design-v1.md` § "Eng Review Lock-in #1 — The 8 Hidden Leak Vectors"** — the authoritative leak-vector list. Phase 4 covers vectors related to fields/hyperlinks. Re-read to confirm what is and isn't in scope.

Commands:

```bash
cat docs/phases/phase-3-handback.md
cat src/docx/coalesce.ts
cat src/docx/redact.ts
cat src/docx/redact-docx.ts
cat src/docx/flatten-track-changes.ts
cat src/docx/strip-comments.ts
cat src/docx/verify.ts
cat src/docx/scopes.ts
```

---

## 3. Invariants (DO NOT VIOLATE)

1. **All prior-phase tests must still pass.** `bun run test` → ≥ 1562 passing (post-Phase-3 + manual-QA fixes) + Phase 4 additions, 0 failing.

2. **No changes to `src/detection/**`, `src/propagation/**`, `src/finalize/**`, `src/ui/**`.** Phase 4 is docx-layer only.

3. **No modifications to existing files EXCEPT:**
   - `src/docx/redact.ts` — ADD `redactInstrText` function and invoke from `redactScopeXml`. Do not change `redactParagraph` or `findRedactionMatches`.
   - `src/docx/redact-docx.ts` — ADD one line to call `flattenFields` in the pipeline. Do not reorder existing steps.
   - `src/docx/verify.ts` — EXTEND `verifyRedaction` to also scan rels. Do not change the `VerifyResult` interface or the existing scope-scan behavior.

4. **No changes to `package.json` dependencies.** Zero `bun add` / `npm install`.

5. **No changes to `vite.config.ts`, `eslint.config.js`, `tsconfig.json`, `svelte.config.js`.**

6. **`.js` extension in imports.** `import type` for type-only imports (verbatimModuleSyntax).

7. **No `try/catch`** in `flatten-fields.ts` or the new functions in `redact.ts` / `verify.ts`. Fail-loud per design-v1 Lock-in #15.

8. **Phase 0 characterization preserved.** `bun run test src/detection/detect-pii.characterization.test.ts` passes byte-for-byte. Detection on the worst-case fixture produces identical candidate counts before and after Phase 4.

9. **Idempotent transformations.** `flattenFields(xml)` applied twice gives the same result as once. Same for `redactInstrText` post-pass.

10. **Deterministic output.** Running the full pipeline on the same input twice must produce byte-identical output. Build determinism (ship gate check) must still pass.

11. **No network code.** ESLint bans fetch/XHR/WebSocket.

12. **Do NOT `git push`.** Commit locally only.

13. **Do NOT modify `tests/fixtures/`.**

14. **Verifier regression guard.** The existing `VerifyResult.survived` shape is preserved. The new rels scan appends to the same `survived` array (with a synthetic `scope` pointing at the rels file path). Callers treat them uniformly.

---

## 4. Architecture

### 4.1 Pipeline order (after Phase 4)

```
loadAsync(bytes)
   │
   ▼
flattenTrackChanges  (existing — unchanged)
   │ unwraps <w:ins>, drops <w:del>
   ▼
dropCommentsPart  (existing — unchanged)
   │ deletes word/comments.xml + companions
   │ strips comment range markers from body
   ▼
flattenFields  ← NEW (§ 7)
   │ - strips <w:fldChar> runs
   │ - strips <w:instrText> runs (whole <w:r> wrapper)
   │ - unwraps <w:fldSimple> (keeps inner)
   │ - unwraps <w:hyperlink> (keeps inner)
   ▼
redactScopeXml  (existing + EXTENDED to call redactInstrText)
   │ Step 1: existing <w:t>-run-aware redaction (unchanged)
   │ Step 2: redactInstrText safety-net  ← NEW (§ 9)
   │         - scrub any remaining <w:instrText>...</w:instrText> content
   │         - scrub <w:fldSimple w:instr="..."> attribute
   ▼
scrubDocxMetadata  (existing — unchanged)
   │
   ▼
verifyRedaction  (existing + EXTENDED)  ← NEW rels scan (§ 10)
   │ - scans all listScopes (existing)
   │ - scans word/_rels/*.rels Target attributes (NEW)
   ▼
word-count sanity + sha256 + output bytes
```

### 4.2 Module responsibilities

| Module | Phase 4 change |
|---|---|
| `flatten-track-changes.ts` | UNCHANGED |
| `strip-comments.ts` | UNCHANGED |
| `flatten-fields.ts` | **NEW** — pure string transformation. `flattenFields(xml) → string`. Also `flattenFieldsInZip(zip) → void` for the multi-scope wrapper. |
| `coalesce.ts` | UNCHANGED — operates on post-flatten XML that has no field machinery |
| `redact.ts` | **EXTENDED** — add `redactInstrText(xml, targets, placeholder) → string` and invoke from `redactScopeXml` after the existing `<w:t>` pass |
| `redact-docx.ts` | **EXTENDED** — insert `await flattenFieldsInZip(zip)` after `dropCommentsPart` and before the scope walk |
| `verify.ts` | **EXTENDED** — add rels scan that also returns surviving strings with a synthetic scope |
| `scopes.ts` | UNCHANGED |

### 4.3 Why flatten BEFORE detection, not just redact

Two benefits:

1. **Display-text parity.** After flatten, the `<w:t>` runs are the ONLY text in the XML. Coalesce produces the same logical text as before (since fields' display portion was already in `<w:t>`). So detection output is unchanged.

2. **Belt for the instrText belt.** Even if the instrText safety-net scrub misses something (e.g., malformed field XML), the pre-flatten pass already removed it. The user can't hit both failure modes simultaneously unless the input is truly pathological.

---

## 5. File layout

```
src/docx/
├── flatten-fields.ts            ← NEW (~200 lines)
├── flatten-fields.test.ts       ← NEW (~250 lines — 15+ tests)
├── flatten-track-changes.ts     (UNCHANGED)
├── flatten-track-changes.test.ts (UNCHANGED)
├── strip-comments.ts            (UNCHANGED)
├── strip-comments.test.ts       (UNCHANGED)
├── redact.ts                    ← MODIFIED (+~60 lines for redactInstrText)
├── redact.test.ts               ← MODIFIED (+~10 tests)
├── redact-docx.ts               ← MODIFIED (+~3 lines pipeline call)
├── redact-docx.test.ts          ← MODIFIED (+~3 integration tests)
├── verify.ts                    ← MODIFIED (+~50 lines for rels scan)
├── verify.test.ts               ← MODIFIED (+~5 tests)
├── scopes.ts                    (UNCHANGED)
├── coalesce.ts                  (UNCHANGED)
├── render-body.ts               (UNCHANGED — Phase 3)
├── types.ts                     (UNCHANGED)
└── ... (other files UNCHANGED)

docs/phases/
├── phase-4-field-leaks.md       (THIS DOCUMENT)
└── phase-4-handback.md          ← NEW at end of phase
```

**Counts:**
- New files: 2 (flatten-fields.ts + test)
- Modified files: 6 (redact.ts + test, redact-docx.ts + test, verify.ts + test)
- Unchanged: every other docx file, every non-docx file

---

## 6. WordprocessingML field reference (authoritative)

Before writing flatten-fields.ts, know the three field shapes. All three can carry sensitive strings in a form the current redactor does not touch.

### 6.1 Simple field (`<w:fldSimple>`)

Instruction is in the `w:instr` attribute. Display is the inner content (one or more runs).

```xml
<w:p>
  <w:r><w:t>이메일: </w:t></w:r>
  <w:fldSimple w:instr=" HYPERLINK &quot;mailto:contact@pearlabyss.com&quot; ">
    <w:r>
      <w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr>
      <w:t>contact@pearlabyss.com</w:t>
    </w:r>
  </w:fldSimple>
</w:p>
```

**Flatten:** remove the `<w:fldSimple ...>` open tag and `</w:fldSimple>` close tag, keep the inner runs verbatim. The `w:instr` attribute (which contains the URL) disappears.

### 6.2 Complex field (`<w:fldChar>` markers)

Instruction is in a separate `<w:r><w:instrText>...</w:instrText></w:r>` run, delimited by `<w:fldChar w:fldCharType="begin"/>` and `<w:fldChar w:fldCharType="separate"/>`. Display text follows `separate` and precedes `<w:fldChar w:fldCharType="end"/>`.

```xml
<w:p>
  <w:r><w:t>담당자: </w:t></w:r>
  <w:r><w:fldChar w:fldCharType="begin"/></w:r>
  <w:r>
    <w:instrText xml:space="preserve"> HYPERLINK "mailto:contact@pearlabyss.com" </w:instrText>
  </w:r>
  <w:r><w:fldChar w:fldCharType="separate"/></w:r>
  <w:r>
    <w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr>
    <w:t>contact@pearlabyss.com</w:t>
  </w:r>
  <w:r><w:fldChar w:fldCharType="end"/></w:r>
</w:p>
```

**Flatten:** remove ALL `<w:r>...<w:fldChar .../></w:r>` runs (begin / separate / end markers). Remove the `<w:r>` that contains `<w:instrText>` entirely (the instruction run). KEEP the display run (the one between `separate` and `end` that has `<w:t>`).

**Critical subtlety:** a single complex field may span multiple consecutive runs for both instruction AND display. For instruction, all runs between `begin` and `separate` are instruction. For display, all runs between `separate` and `end` are display. Flatten's algorithm must respect these boundaries.

### 6.3 Hyperlink (`<w:hyperlink>`)

Wraps one or more runs. The URL target is in `word/_rels/document.xml.rels` (and sibling rels files for header/footer/etc.), looked up by the `r:id` attribute.

```xml
<w:p>
  <w:r><w:t>문의: </w:t></w:r>
  <w:hyperlink r:id="rId5" w:history="1">
    <w:r>
      <w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr>
      <w:t>contact@pearlabyss.com</w:t>
    </w:r>
  </w:hyperlink>
</w:p>
```

In `word/_rels/document.xml.rels`:

```xml
<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="mailto:contact@pearlabyss.com" TargetMode="External"/>
```

**Flatten (in-paragraph):** remove the `<w:hyperlink ...>` open tag and `</w:hyperlink>` close tag, keep the inner runs verbatim.

**Rels cleanup:** NOT done by flatten. The orphaned rels entry is harmless (nothing references it), but the Target URL contains the sensitive string. The verifier's new rels scan (§ 10) catches this and the download is blocked until the user removes the sensitive URL from the source document.

### 6.4 Acknowledged field variants NOT specifically handled

- **Nested fields** (field-in-field, rare but possible) — the flatten regex handles them implicitly because it strips ALL matching tags.
- **`<w:sdt>` (structured document tags) with content-control bindings** — not a field per se, but can contain placeholder text with binding metadata. OUT OF SCOPE; future phase.
- **Math fields (`<m:oMath>`)** — OUT OF SCOPE.
- **`<w:fldSimple>` with `w:dirty="1"` flag** — treated same as regular simple field.
- **`<w:custXmlInsRangeStart/End>` markers** — tracked custom-XML inserts, NOT in scope.

---

## 7. `flatten-fields.ts` specification

Put this EXACTLY into `src/docx/flatten-fields.ts`:

```typescript
/**
 * Flatten WordprocessingML field machinery to plain runs.
 *
 * Eng review lock-in #1 leak vector extension (post-Phase-3): complex and
 * simple fields embed their instruction text inside `<w:instrText>` runs and
 * `<w:fldSimple w:instr="...">` attributes, both of which the regular
 * `<w:t>`-scoped redactor does NOT see. A HYPERLINK field to
 * "mailto:contact@pearlabyss.com" stores the address in the instruction;
 * when redaction replaces the display text with [REDACTED], the address
 * survives in the instruction and the round-trip verifier blocks the
 * download.
 *
 * Flatten strategy (applied per-scope XML):
 *
 *   1. Complex field runs:
 *        - Drop every <w:r>...<w:fldChar .../>...</w:r> begin/separate/end
 *          marker run.
 *        - Drop every <w:r>...<w:instrText>...</w:instrText>...</w:r>
 *          instruction run.
 *        - Keep every other run (the display text).
 *
 *   2. Simple fields:
 *        - Replace <w:fldSimple w:instr="..."> ... </w:fldSimple> with just
 *          the inner content (runs are preserved).
 *
 *   3. Hyperlinks:
 *        - Replace <w:hyperlink ...> ... </w:hyperlink> with just the inner
 *          content (runs are preserved). The r:id attribute is dropped —
 *          the rels entry becomes orphaned but harmless.
 *
 * This is a pure string-in / string-out transformation, idempotent. A second
 * application has no effect because all field tags are gone after the first.
 *
 * Out of scope: structured document tags (<w:sdt>), math fields (<m:oMath>),
 * custom XML insertions. These are Paranoid-mode vectors and remain
 * unflattened in Phase 4.
 *
 * Public API:
 *   - flattenFields(xml) → string          (pure, per-scope)
 *   - flattenFieldsInZip(zip) → Promise<void>  (multi-scope wrapper)
 */

import type JSZip from "jszip";

import { listScopes, readScopeXml } from "./scopes.js";

/**
 * Flatten every field and hyperlink in a single XML scope. Idempotent.
 *
 * Order of operations:
 *   1. Remove complex-field runs (begin/separate/end markers + instrText runs)
 *   2. Unwrap fldSimple (preserves inner runs)
 *   3. Unwrap hyperlinks (preserves inner runs)
 */
export function flattenFields(xml: string): string {
  let out = xml;

  // Step 1a: drop entire <w:r>...</w:r> wrappers whose only non-rPr child is
  // a <w:fldChar .../>. These are begin/separate/end markers and carry no
  // visible text.
  out = out.replace(
    /<w:r(?:\s[^>]*)?>[\s\S]*?<w:fldChar[^>]*\/>[\s\S]*?<\/w:r>/g,
    "",
  );

  // Step 1b: drop entire <w:r>...</w:r> wrappers that contain a
  // <w:instrText>...</w:instrText>. These carry the field instruction (with
  // the sensitive URL/email). Use non-greedy on the outer run so we don't
  // eat adjacent runs.
  out = out.replace(
    /<w:r(?:\s[^>]*)?>[\s\S]*?<w:instrText(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/w:instrText>)[\s\S]*?<\/w:r>/g,
    "",
  );

  // Step 2: unwrap <w:fldSimple ...>inner</w:fldSimple> → inner.
  // The w:instr attribute (which carries the instruction string) is on the
  // open tag and disappears when we drop it.
  out = out.replace(
    /<w:fldSimple(?:\s[^>]*)?>([\s\S]*?)<\/w:fldSimple>/g,
    "$1",
  );
  // Self-closing <w:fldSimple .../> (no display) — remove entirely.
  out = out.replace(/<w:fldSimple[^>]*\/>/g, "");

  // Step 3: unwrap <w:hyperlink ...>inner</w:hyperlink> → inner.
  out = out.replace(
    /<w:hyperlink(?:\s[^>]*)?>([\s\S]*?)<\/w:hyperlink>/g,
    "$1",
  );
  // Self-closing <w:hyperlink .../> — remove (no display content).
  out = out.replace(/<w:hyperlink[^>]*\/>/g, "");

  return out;
}

/**
 * Apply `flattenFields` to every text-bearing scope in a zip in place.
 * Idempotent at the zip level too.
 */
export async function flattenFieldsInZip(zip: JSZip): Promise<void> {
  for (const scope of listScopes(zip)) {
    const xml = await readScopeXml(zip, scope);
    const flattened = flattenFields(xml);
    if (flattened !== xml) {
      zip.file(scope.path, flattened);
    }
  }
}
```

### 7.1 Why regex, not a proper XML parser

WordprocessingML is nominally XML, but the `strip-comments.ts`, `flatten-track-changes.ts`, and `redact.ts` modules all operate on string patterns for three reasons:

1. **Bundle size.** A full XML parser (fast-xml-parser, sax) is ~50–100 KB. This is a file:// single-HTML product — every KB matters.
2. **Round-trip preservation.** Parsing + reserializing loses whitespace, attribute order, namespace prefixes. The redactor must output byte-compatible XML.
3. **Partial matches.** The redactor only needs to find-and-replace a few elements; walking the full tree is unnecessary overhead.

Phase 4 follows the same convention: regex-based string transformation.

### 7.2 Regex ordering is load-bearing

The `out = out.replace(...)` sequence processes runs first (step 1), then wrappers (steps 2, 3). If order were reversed:

- Unwrap hyperlinks first → the inner runs are exposed
- Then drop `<w:r>` containing `<w:instrText>` → works fine
- Then drop `<w:r>` containing `<w:fldChar>` → works fine

So the order doesn't matter for correctness, but the current order reads naturally as "peel from innermost to outermost". Don't reorder without a reason.

### 7.3 Idempotence

Running `flattenFields` on already-flattened XML is a no-op because every pattern matches zero occurrences. Test case required:

```typescript
it("is idempotent — second application is a no-op", () => {
  const raw = loadFixtureXml();
  const once = flattenFields(raw);
  const twice = flattenFields(once);
  expect(twice).toBe(once);
});
```

### 7.4 Performance

All 6 regex passes are linear in input size (non-greedy + no nested quantifiers). Total: O(n) per scope. For a 50KB scope with ~10 fields, total time is < 10ms. No ReDoS guard test needed (matches flatten-track-changes.ts convention).

---

## 8. Hyperlink unwrap + rels cleanup

### 8.1 What `flattenFields` does for hyperlinks

In step 3, `<w:hyperlink r:id="rId5">...</w:hyperlink>` becomes just `...` (the inner runs). The `r:id="rId5"` reference is gone.

### 8.2 What `flattenFields` does NOT do

It does NOT open `word/_rels/document.xml.rels` to remove the orphaned `<Relationship Id="rId5" Target="mailto:contact@pearlabyss.com" />` entry. That entry is now orphaned (nothing references it) but still present in the file.

### 8.3 Why leave orphaned rels

Three reasons:

1. **Cross-file coordination is fragile.** Rels files exist per scope (`word/_rels/document.xml.rels`, `word/_rels/header1.xml.rels`, etc.). A proper unwrap-and-clean requires tracking which rId was unwrapped in which scope, then editing the matching rels. String-level regex can't easily do this.

2. **Orphans are harmless for Word.** Word ignores orphaned rels entries. The document opens and reads normally. No user-visible impact.

3. **The verifier catches the leak.** Section 10 extends `verifyRedaction` to scan ALL rels files for sensitive strings. If an orphaned rels entry still contains a sensitive URL, the verifier flags it and blocks the download.

### 8.4 User-facing implication

If a contract has a hyperlink to `mailto:contact@pearlabyss.com`, Phase 4 will:

1. Flatten strips the `<w:hyperlink>` wrapper, leaving the display text `contact@pearlabyss.com` as a plain run.
2. Detection sees the email and emits a `piiCandidates` entry.
3. User checks it, clicks Apply.
4. Redactor replaces the display text with `[REDACTED]`.
5. Metadata scrub cleans `docProps`.
6. Verifier scans scopes (finds nothing) + scans rels (finds `mailto:contact@pearlabyss.com` in an orphaned entry) → reports survived.
7. Download blocked.
8. User sees the verify-fail banner with the rels path, clicks "Back to review", and uses the 기타 section to add `contact@pearlabyss.com` to their manual list, OR understands that the URL-bearing rels entry needs a separate treatment.

This is SAFE behavior — we flag the leak rather than silently allowing it.

**Future phase** may implement a full rels scrub (remove orphaned entries + scrub sensitive Target values). For now, the verifier's detection is the safety net.

---

## 9. `redact.ts` instrText safety net

Even after `flattenFields` runs, defensive programming: what if a malformed field escapes the regex? (E.g., bizarre Word export bug where `<w:instrText>` is NOT wrapped in `<w:r>`.) Add a second-layer scrub inside `redactScopeXml` after the existing `<w:t>`-aware pass.

### 9.1 Function specification

Add this function to `src/docx/redact.ts` after the existing `redactParagraph`:

```typescript
/**
 * Safety-net: scrub sensitive strings from any `<w:instrText>` content or
 * `<w:fldSimple w:instr="...">` attribute that survives the flatten pass.
 *
 * This should rarely fire — `flattenFields` (src/docx/flatten-fields.ts)
 * strips all field machinery before this runs. This pass is defense in
 * depth for malformed Word exports where a bare <w:instrText> sits
 * outside a <w:r>, or exotic fields the flatten regex did not anticipate.
 *
 * Strategy: for each sensitive string, string-replace with the placeholder
 * inside instruction regions. This preserves XML structure (the element
 * tags remain) but removes the sensitive payload.
 *
 * Pure function. Returns the rewritten XML.
 */
export function redactInstrText(
  xml: string,
  targets: ReadonlyArray<string>,
  placeholder: string = DEFAULT_PLACEHOLDER,
): string {
  if (targets.length === 0) return xml;
  const sorted = [...targets]
    .filter((t) => t.length > 0)
    .sort((a, b) => b.length - a.length);
  if (sorted.length === 0) return xml;

  // Step 1: scrub <w:instrText>...</w:instrText> content.
  let out = xml.replace(
    /<w:instrText(?:\s[^>]*)?>([\s\S]*?)<\/w:instrText>/g,
    (full, inner: string) => {
      let redacted = inner;
      for (const t of sorted) {
        redacted = redacted.split(t).join(placeholder);
      }
      if (redacted === inner) return full;
      // Preserve the open tag + attributes; replace only the content.
      return full.replace(inner, redacted);
    },
  );

  // Step 2: scrub the w:instr attribute on <w:fldSimple>. The attribute is
  // XML-attribute-encoded (e.g., " with &quot;), so we must look for the
  // sensitive string in BOTH its plain and entity-encoded form.
  out = out.replace(
    /(<w:fldSimple\s[^>]*?w:instr=")([^"]*)("[^>]*>)/g,
    (full, open: string, instr: string, close: string) => {
      let redacted = instr;
      for (const t of sorted) {
        // Plain string replace
        redacted = redacted.split(t).join(placeholder);
        // Entity-encoded (quote chars inside URLs)
        const encoded = t.replace(/"/g, "&quot;");
        if (encoded !== t) {
          redacted = redacted.split(encoded).join(placeholder);
        }
      }
      if (redacted === instr) return full;
      return `${open}${redacted}${close}`;
    },
  );

  return out;
}
```

### 9.2 Invocation from `redactScopeXml`

Extend the existing function:

```typescript
export function redactScopeXml(
  scopeXml: string,
  targets: ReadonlyArray<string>,
  placeholder: string = DEFAULT_PLACEHOLDER,
): string {
  // Step 1: existing <w:t>-run-aware redaction (unchanged)
  const afterRunRedact = scopeXml.replace(
    /<w:p(?!P|r)(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/w:p>)/g,
    (paragraph) => {
      if (paragraph.endsWith("/>")) return paragraph;
      return redactParagraph(paragraph, targets, placeholder);
    },
  );

  // Step 2 (NEW): safety-net instrText scrub
  return redactInstrText(afterRunRedact, targets, placeholder);
}
```

### 9.3 Why placeholder-replace, not delete

Removing `<w:instrText>` content would leave `<w:instrText></w:instrText>` or `<w:fldSimple w:instr="">...` which Word may treat as malformed. Replacing with `[REDACTED]` keeps the XML structurally valid (Word sees a field with "broken" instruction but tolerates it).

### 9.4 Idempotence

`redactInstrText` is idempotent because the second pass finds no more sensitive strings to replace (first pass already replaced them with the placeholder, which does not contain sensitive strings).

---

## 10. `verify.ts` extension — rels file scan

### 10.1 Why extend

Orphaned rels entries (from unwrapped hyperlinks) still contain URL targets with sensitive payloads (`Target="mailto:contact@..."`). These URLs are not visible in Word's editing view but ARE present in the file. Sharing the redacted DOCX with the original rels intact would be a leak.

The verifier is the right place to catch this: its only job is to say "nothing sensitive survived in the output bytes". Extending its scan to cover rels is a natural fit.

### 10.2 Implementation

Extend `verifyRedaction` in `src/docx/verify.ts`:

```typescript
/**
 * Walk every text-bearing scope AND every rels file in the zip; for each
 * sensitive string, check presence and count occurrences. Returns a
 * VerifyResult.
 *
 * Rels scanning (Phase 4 addition):
 *   - Enumerates word/_rels/*.rels via zip.folder("word/_rels")
 *   - For each rels file, scan the raw XML string with String.indexOf on
 *     each sensitive target
 *   - Surviving strings are appended to the `survived` array with a
 *     synthetic Scope whose `kind: "rels"` and `path: <rels file path>`
 *
 * IMPORTANT: the Scope type must accommodate the "rels" kind. If Scope is
 * currently a closed union, extend it in `src/docx/types.ts`. If Scope is
 * a structural/open type, just set kind: "rels" directly.
 */
```

### 10.3 Scope type extension

Check `src/docx/types.ts` for the `Scope` type. If it's a discriminated union like:

```typescript
type Scope =
  | { kind: "body"; path: string }
  | { kind: "header"; path: string; index: number }
  | ...;
```

Add:

```typescript
  | { kind: "rels"; path: string };
```

If it's structural (just a `kind: string` without enumerated values), no change needed — use `kind: "rels"` directly.

### 10.4 Rels-scan implementation

Inside `verify.ts`:

```typescript
import type JSZip from "jszip";
import { listScopes, readScopeXml } from "./scopes.js";
import type { Scope, SurvivedString, VerifyResult } from "./types.js";

export async function verifyRedaction(
  zip: JSZip,
  sensitive: ReadonlyArray<string>,
): Promise<VerifyResult> {
  const survived: SurvivedString[] = [];

  // Existing scope walk (unchanged)
  for (const scope of listScopes(zip)) {
    const xml = await readScopeXml(zip, scope);
    for (const text of sensitive) {
      const count = countOccurrences(xml, text);
      if (count > 0) {
        survived.push({ text, scope, count });
      }
    }
  }

  // NEW: rels file scan
  for (const relsPath of listRelsPaths(zip)) {
    const relsXml = await zip.file(relsPath)!.async("string");
    for (const text of sensitive) {
      const count = countOccurrences(relsXml, text);
      if (count > 0) {
        survived.push({
          text,
          scope: { kind: "rels", path: relsPath } as Scope,
          count,
        });
      }
    }
  }

  return { isClean: survived.length === 0, survived };
}

/**
 * Enumerate every .rels file in the zip. DOCX puts rels in:
 *   - word/_rels/document.xml.rels (body)
 *   - word/_rels/header1.xml.rels, header2.xml.rels, ...
 *   - word/_rels/footer1.xml.rels, ...
 *   - word/_rels/footnotes.xml.rels (rare)
 *   - word/_rels/comments.xml.rels (rare)
 *   - _rels/.rels (root — not typically text-bearing but scan anyway)
 */
function listRelsPaths(zip: JSZip): string[] {
  const paths: string[] = [];
  zip.forEach((relativePath) => {
    if (relativePath.endsWith(".rels")) {
      paths.push(relativePath);
    }
  });
  return paths.sort();
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}
```

### 10.5 Testing

Add to `verify.test.ts`:

```typescript
it("detects survived URL in word/_rels/document.xml.rels", async () => {
  const zip = new JSZip();
  zip.file("word/document.xml", "<w:document><w:body></w:body></w:document>");
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0"?><Relationships xmlns="..."><Relationship Id="rId1" Type="..." Target="mailto:contact@pearlabyss.com" TargetMode="External"/></Relationships>`,
  );

  const result = await verifyRedaction(zip, ["contact@pearlabyss.com"]);

  expect(result.isClean).toBe(false);
  expect(result.survived).toHaveLength(1);
  expect(result.survived[0]!.scope.kind).toBe("rels");
  expect(result.survived[0]!.scope.path).toBe("word/_rels/document.xml.rels");
});

it("clean rels file returns isClean=true", async () => {
  const zip = new JSZip();
  zip.file("word/document.xml", "<w:document><w:body></w:body></w:document>");
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0"?><Relationships xmlns="..."></Relationships>`,
  );

  const result = await verifyRedaction(zip, ["contact@pearlabyss.com"]);

  expect(result.isClean).toBe(true);
  expect(result.survived).toHaveLength(0);
});
```

---

## 11. Pipeline order in `redact-docx.ts`

Current (pre-Phase-4):

```typescript
// 1. flatten track changes
await flattenTrackChangesInZip(zip);

// 2. drop comments
dropCommentsPart(zip);
stripCommentReferences(zip);

// 3. walk scopes, redact each
for (const scope of listScopes(zip)) {
  const xml = await readScopeXml(zip, scope);
  const redacted = redactScopeXml(xml, targets);
  if (redacted !== xml) zip.file(scope.path, redacted);
}

// 4. scrub metadata
await scrubDocxMetadata(zip);

// 5. verify
const verify = await verifyRedaction(zip, targets);
```

After Phase 4 (insert step 2.5):

```typescript
// 1. flatten track changes
await flattenTrackChangesInZip(zip);

// 2. drop comments
dropCommentsPart(zip);
stripCommentReferences(zip);

// 2.5 (NEW) flatten fields — strip <w:fldChar>, <w:instrText>,
// <w:fldSimple>, <w:hyperlink> wrappers from every scope
await flattenFieldsInZip(zip);

// 3. walk scopes, redact each (redactScopeXml internally calls
//    redactInstrText as a safety net)
for (const scope of listScopes(zip)) {
  ...
}

// 4. scrub metadata (unchanged)
await scrubDocxMetadata(zip);

// 5. verify (NOW scans rels files too)
const verify = await verifyRedaction(zip, targets);
```

One line added. Order preserved relative to existing steps.

---

## 12. Testing strategy

### 12.1 `flatten-fields.test.ts` (≥ 15 tests)

Organization mirrors `flatten-track-changes.test.ts`. Tests exercise each field shape independently, then combinations.

| Group | Tests | Focus |
|---|---:|---|
| Simple field | 4 | `<w:fldSimple>` unwrap; with/without `w:instr`; nested runs; self-closing |
| Complex field | 5 | Begin/separate/end marker removal; instrText run removal; display preservation; multi-run display; split across paragraphs (should NOT cross boundary since flatten runs per-scope) |
| Hyperlink | 3 | Unwrap with r:id; multiple consecutive hyperlinks; nested inner runs with formatting |
| Mixed | 2 | Simple + complex + hyperlink all in one paragraph; adjacent fields |
| Idempotence | 1 | Double-apply is a no-op |

### 12.2 `redact.test.ts` additions (≥ 10 tests)

| Group | Tests | Focus |
|---|---:|---|
| `redactInstrText` — instrText | 4 | Single sensitive string; multiple; longest-first; no-match early exit |
| `redactInstrText` — fldSimple attr | 3 | Plain string; entity-encoded `&quot;`; multiple attrs |
| Pipeline integration | 3 | `redactScopeXml` now runs both passes; idempotent; preserves other XML |

### 12.3 `redact-docx.test.ts` integration additions (≥ 3 tests)

| Test | Purpose |
|---|---|
| Synthetic zip with `<w:instrText>HYPERLINK "mailto:foo@bar.com"</w:instrText>` | After pipeline, verify `zip.file("word/document.xml").async("string")` does not contain `foo@bar.com` |
| Synthetic zip with `<w:fldSimple w:instr="... mailto:foo@bar.com ...">display text</w:fldSimple>` | After pipeline, instr attribute scrubbed |
| Synthetic zip with hyperlink + orphaned rels | After pipeline, rels still has orphaned entry but verifier flags it |

### 12.4 `verify.test.ts` additions (≥ 5 tests)

| Test | Purpose |
|---|---|
| Rels file with sensitive URL → survived | Primary new behavior |
| Rels file clean → isClean=true | Regression guard |
| Multiple rels files (header + body + footer rels) | Enumeration correctness |
| Empty zip | No false positives |
| Rels file path sorted | Deterministic ordering |

### 12.5 No Svelte component tests

Consistent with prior phases. UI doesn't change in Phase 4.

### 12.6 Total Phase 4 test count

- `flatten-fields.test.ts`: ≥ 15 tests
- `redact.test.ts`: ≥ 10 tests
- `redact-docx.test.ts`: ≥ 3 tests
- `verify.test.ts`: ≥ 5 tests
- **Total new**: ≥ 33 tests

Bringing suite from ~1562 → ~1595.

---

## 13. TDD sequence (9 steps)

### Step 1 — Baseline verification (no commit)

```bash
cd "/Users/kpsfamily/코딩 프로젝트/document-redactor"
bun run test 2>&1 | tail -5
# Expected: 1562 passing (or whatever the post-Phase-3 baseline is)
bun run typecheck 2>&1 | tail -3
# Expected: 0 errors

PHASE3_HEAD=$(git rev-parse --short HEAD)
echo "Phase 3 HEAD: $PHASE3_HEAD"
```

Fail-stop if baseline is not clean.

### Step 2 — Create `flatten-fields.ts` + tests (1 commit)

Create `src/docx/flatten-fields.ts` per § 7. Create `src/docx/flatten-fields.test.ts` with ≥ 15 tests per § 12.1.

**Verify:**
```bash
bun run test src/docx/flatten-fields.test.ts 2>&1 | tail -5
bun run typecheck 2>&1 | tail -3
```

**Commit message:** `feat(docx): add flatten-fields module — strip fields and unwrap hyperlinks`

### Step 3 — Add `redactInstrText` + tests (1 commit)

Extend `src/docx/redact.ts` with `redactInstrText` function per § 9.1. Invoke from `redactScopeXml` per § 9.2.

**Verify:**
```bash
bun run test src/docx/redact.test.ts 2>&1 | tail -5
bun run test src/detection/detect-pii.characterization.test.ts 2>&1 | tail -5
# Phase 0 ship gate still passes
```

**Commit message:** `feat(docx/redact): add instrText safety-net scrub in redactScopeXml`

### Step 4 — Wire `flattenFieldsInZip` into pipeline (1 commit)

Modify `src/docx/redact-docx.ts` per § 11. Add ≥ 3 integration tests per § 12.3.

**Verify:**
```bash
bun run test src/docx/redact-docx.test.ts 2>&1 | tail -5
bun run test 2>&1 | tail -5
# All Phase 0-3 tests still pass
```

**Commit message:** `feat(docx/redact-docx): insert flattenFieldsInZip pass after strip-comments`

### Step 5 — Extend `verify.ts` for rels scan (1 commit)

Add `listRelsPaths` + extend `verifyRedaction` per § 10. Potentially extend `Scope` type in `types.ts` per § 10.3. Add ≥ 5 tests per § 12.4.

**Verify:**
```bash
bun run test src/docx/verify.test.ts 2>&1 | tail -5
bun run test src/docx/redact-docx.test.ts 2>&1 | tail -5
# Integration tests still green
```

**Commit message:** `feat(docx/verify): scan rels files for surviving sensitive strings`

### Step 6 — Full-suite regression check (no commit)

```bash
bun run test 2>&1 | tail -10
# Expected: ≥ 1595 passing, 0 failing
bun run typecheck 2>&1 | tail -3
bun run lint 2>&1 | tail -5
bun run build 2>&1 | tail -5
```

If any failure, fix in a follow-up commit before proceeding.

### Step 7 — Build determinism check (no commit)

```bash
FIRST=$(cat dist/document-redactor.html.sha256 | awk '{print $1}')
bun run build 2>&1 > /dev/null
SECOND=$(cat dist/document-redactor.html.sha256 | awk '{print $1}')
[ "$FIRST" = "$SECOND" ] && echo "DETERMINISM OK: $FIRST" || echo "FAIL"
```

### Step 8 — End-to-end fixture test (1 commit, optional)

If time permits, add a new fixture under `tests/fixtures/` that specifically exercises:
- A hyperlink with email Target in rels
- A complex field with `<w:instrText>HYPERLINK "mailto:x@y.com"</w:instrText>`
- A simple field with `w:instr=" HYPERLINK &quot;http://example.com/secret&quot; "`

Run the full pipeline (analyzeZip + applyRedaction) on this fixture and assert zero survived.

**NOTE:** per Phase 4 invariant 13, `tests/fixtures/` should NOT be modified. Construct the zip in-memory inside the test file instead.

**Verify:** all ≥ 1598 tests pass.

**Commit message:** `test(docx): add end-to-end field-leak integration test on synthetic zip`

### Step 9 — Handback document (1 commit)

Create `docs/phases/phase-4-handback.md` per the template in § 15.5.

**Commit message:** `docs(phases): add Phase 4 handback — field/hyperlink leak vectors closed`

### TDD step summary

| Step | Files | Tests added | Running total |
|---|---|---:|---:|
| 1 | (verify) | 0 | 1562 |
| 2 | flatten-fields.ts + test | ~15 | ~1577 |
| 3 | redact.ts + test | ~10 | ~1587 |
| 4 | redact-docx.ts + test | ~3 | ~1590 |
| 5 | verify.ts + types.ts + test | ~5 | ~1595 |
| 6 | (verify + regression) | 0 | ~1595 |
| 7 | (build determinism) | 0 | ~1595 |
| 8 | redact-docx.test.ts (optional e2e) | ~3 | ~1598 |
| 9 | phase-4-handback.md | 0 | ~1598 |

---

## 14. Verification commands (ship gate)

```bash
cd "/Users/kpsfamily/코딩 프로젝트/document-redactor"

# 1. Git state
git status
git log --oneline $PHASE3_HEAD..HEAD  # 5-7 new commits

# 2. Tests
bun run test 2>&1 | tail -10
# Expected: ≥ 1595 passing, 0 failing

# 3. Phase 0 ship gate STILL passes
bun run test src/detection/detect-pii.characterization.test.ts 2>&1 | tail -5
# Expected: 24 passing

# 4. Phase 1-3 test files still pass
bun run test src/detection/detect-all.test.ts 2>&1 | tail -5
bun run test src/detection/detect-all.integration.test.ts 2>&1 | tail -5
bun run test src/ui/engine.test.ts 2>&1 | tail -5
bun run test src/ui/ship-gate.test.ts 2>&1 | tail -5
bun run test src/docx/render-body.test.ts 2>&1 | tail -5

# 5. Phase 4 new test files
bun run test src/docx/flatten-fields.test.ts 2>&1 | tail -5
bun run test src/docx/redact.test.ts 2>&1 | tail -5
bun run test src/docx/redact-docx.test.ts 2>&1 | tail -5
bun run test src/docx/verify.test.ts 2>&1 | tail -5

# 6. Type check
bun run typecheck 2>&1 | tail -5

# 7. Lint
bun run lint 2>&1 | tail -5

# 8. Build
bun run build 2>&1 | tail -10

# 9. Build determinism
FIRST=$(cat dist/document-redactor.html.sha256 | awk '{print $1}')
bun run build 2>&1 > /dev/null
SECOND=$(cat dist/document-redactor.html.sha256 | awk '{print $1}')
[ "$FIRST" = "$SECOND" ] && echo "DETERMINISM OK: $FIRST" || echo "FAIL"

# 10. No changes to locked directories
git diff $PHASE3_HEAD -- src/detection/ | head -5  # expect empty
git diff $PHASE3_HEAD -- src/propagation/ | head -5
git diff $PHASE3_HEAD -- src/finalize/ | head -5
git diff $PHASE3_HEAD -- src/ui/ | head -5

# 11. Locked docx files unchanged
git diff $PHASE3_HEAD -- src/docx/coalesce.ts | head -5
git diff $PHASE3_HEAD -- src/docx/scopes.ts | head -5
git diff $PHASE3_HEAD -- src/docx/flatten-track-changes.ts | head -5
git diff $PHASE3_HEAD -- src/docx/strip-comments.ts | head -5
git diff $PHASE3_HEAD -- src/docx/scrub-metadata.ts | head -5
git diff $PHASE3_HEAD -- src/docx/render-body.ts | head -5

# 12. No network code in new files
grep -rn 'fetch\|XMLHttpRequest\|WebSocket\|EventSource\|sendBeacon' src/docx/flatten-fields.ts src/docx/verify.ts src/docx/redact.ts 2>&1 | grep -v '\.test\.' | grep -v '^import' || echo "clean"

# 13. No try/catch in new/modified production code
grep -rn '\btry\b' src/docx/flatten-fields.ts src/docx/redact.ts src/docx/verify.ts 2>&1 | grep -v '\.test\.' || echo "clean"
```

All must pass for the phase to be accepted.

---

## 15. Gotchas + out-of-scope + acceptance + handback + error handling

### 15.1 Gotchas

**15.1.1 Non-greedy regex can over-match across adjacent runs.**  The run-drop regex `<w:r(?:\s[^>]*)?>[\s\S]*?<w:fldChar[^>]*\/>[\s\S]*?<\/w:r>` uses `[\s\S]*?` which is non-greedy, but if one run's content contains `<w:fldChar>` AND `</w:r>` literally in text (impossible in valid XML), the regex could misfire. In practice, WordprocessingML never embeds those strings as literal text; they're always XML tags. Accept the simplification.

**15.1.2 Split scopes reuse the same instrText.** Rare but possible: a complex field could theoretically span paragraph boundaries (`<w:fldChar begin>` in one paragraph, `<w:fldChar end>` in the next). The regex operates per-paragraph due to how `redactScopeXml` splits on `<w:p>`. Flatten runs at the SCOPE level (entire `document.xml` at once) before paragraph splitting, so it handles this case. Verify by test.

**15.1.3 `w:instr` attribute escaping.** The `w:instr` attribute value is XML-attribute-encoded. Quote chars `"` inside URLs are escaped as `&quot;`. The scrub in § 9.1 handles both forms explicitly. If you add other entity handling (e.g., `&amp;` for `&` inside URLs), test each independently.

**15.1.4 Self-closing `<w:hyperlink .../>`.** Rare but valid: a hyperlink with no display content. Flatten removes it entirely (no inner runs to preserve). Verify by test.

**15.1.5 Rels file enumeration — ensure sorted.** `zip.forEach` iterates in arbitrary order. `listRelsPaths` must sort the returned array so test assertions are deterministic.

**15.1.6 `_rels/.rels` (root rels).** The root-level `_rels/.rels` file typically contains only app-level relationships (no user data), but scan it anyway for completeness. It costs nothing.

**15.1.7 `redactInstrText` idempotence.** If the first pass replaces `contact@pearlabyss.com` with `[REDACTED]`, the second pass finds no sensitive strings to replace (assuming `[REDACTED]` is not in targets — it isn't, per the placeholder contract).

**15.1.8 Scope type extension.** If `Scope` in `src/docx/types.ts` is a discriminated union, extending it with `"rels"` requires all discriminators (rendering, logging, etc.) to handle the new case. Phase 3's `RenderedBody.svelte` has a `scopeLabel` function — check if it needs an update. Phase 4 prefers NOT to render rels content in RenderedBody (it's not user-facing text), so `scopeLabel` should fall through to a no-op or "(links)" label.

**15.1.9 `redactInstrText` attribute-replacement edge case.** The regex `(<w:fldSimple\s[^>]*?w:instr=")([^"]*)("[^>]*>)` assumes the attribute value is inside double quotes and contains no double quotes (since they'd be encoded as `&quot;`). If Word outputs single-quoted attributes (`w:instr='...'`), this regex misses them. Word's XML output is conventionally double-quoted per the XML spec, so this is an acceptable simplification.

### 15.2 Out of scope (DO NOT DO)

- ❌ Modify detection, propagation, finalize, or ui layers
- ❌ Modify existing docx files other than the four listed in § 5
- ❌ Implement full rels scrub (remove orphaned entries + scrub Target values)
- ❌ Add any XML parser dependency
- ❌ Handle `<w:sdt>` content controls
- ❌ Handle `<m:oMath>` math fields
- ❌ Handle embedded OLE / OCX objects
- ❌ Strip hidden text (`<w:vanish>`)
- ❌ Strip revision IDs (`w:rsidR`, `w:rsidRoot`)
- ❌ Image EXIF scrubbing
- ❌ Modify fixtures under `tests/fixtures/`
- ❌ Add new npm dependencies
- ❌ Reorder existing pipeline steps in redact-docx.ts (only INSERT flattenFields at the documented position)
- ❌ `git push`

### 15.3 Acceptance criteria

1. ✅ `bun run test` passes ≥ 1595 total, 0 failing
2. ✅ `bun run typecheck` → 0 errors
3. ✅ `bun run lint` → 0 errors (pre-existing warnings OK)
4. ✅ `bun run build` → succeeds, deterministic
5. ✅ Phase 0 characterization tests (T1–T24) pass byte-for-byte
6. ✅ `src/docx/flatten-fields.ts` exports `flattenFields` + `flattenFieldsInZip`
7. ✅ `src/docx/flatten-fields.test.ts` has ≥ 15 tests, all passing
8. ✅ `src/docx/redact.ts` exports `redactInstrText` and calls it from `redactScopeXml`
9. ✅ `src/docx/redact.test.ts` has ≥ 10 new tests (on top of existing)
10. ✅ `src/docx/redact-docx.ts` calls `flattenFieldsInZip` between `dropCommentsPart` and the scope walk
11. ✅ `src/docx/verify.ts` scans `word/_rels/*.rels` (and root `_rels/.rels`) for surviving sensitive strings
12. ✅ `src/docx/verify.test.ts` has ≥ 5 new tests covering rels scan
13. ✅ `flattenFields` is idempotent
14. ✅ `redactInstrText` is idempotent
15. ✅ End-to-end: synthetic zip with email-bearing HYPERLINK field + orphaned rels → after applyRedaction, rels-scan flags the survival and `isClean === false`
16. ✅ Locked layers unchanged: `src/detection/`, `src/propagation/`, `src/finalize/`, `src/ui/`
17. ✅ Locked docx files unchanged: `coalesce.ts`, `scopes.ts`, `flatten-track-changes.ts`, `strip-comments.ts`, `scrub-metadata.ts`, `render-body.ts`
18. ✅ No new npm dependencies
19. ✅ No try/catch in new production code (`flatten-fields.ts`, new functions in `redact.ts` / `verify.ts`)
20. ✅ No network code in new files
21. ✅ 5–9 commits with conventional format + `Co-Authored-By: Codex`
22. ✅ Handback doc at `docs/phases/phase-4-handback.md`
23. ✅ On manual verification: dropping the user's pearlabyss document + redacting `contact@pearlabyss.com` no longer fails verification (or, if it still fails due to rels survival, the user sees the new `kind: "rels"` surviving entry and understands the source)

### 15.4 Error handling (3-attempt rule)

Same as Phase 0/1/2/3. If 3 attempts fail, write BLOCKED section in handback and exit.

**If `flattenFields` regex over-matches or under-matches:**
- Add a test that captures the exact problematic XML (copy/paste from a real .docx extracted with `unzip -p`)
- Adjust the regex with MINIMAL change to handle that case
- DO NOT rewrite the whole function

**If `redact.test.ts` fails after adding `redactInstrText`:**
- Most likely: the existing test fixtures happen to contain `<w:instrText>` and the new pass modifies their XML in a way the test didn't anticipate
- Either update the test expectation or tighten `redactInstrText` to only scrub when targets are non-empty
- DO NOT skip or disable tests

**If `verify.ts` type error on the new `scope.kind = "rels"`:**
- Extend `Scope` in `types.ts` with the new kind (§ 10.3)
- Update any discriminating switch statements that would become non-exhaustive
- Document the change in the handback's "scope type extension" note

**If `redact-docx.test.ts` integration test fails:**
- Trace: does flatten actually strip the field machinery?
- Does redactInstrText fire on any remaining instrText?
- Does verify pick up the rels survival?
- Add `console.log(zip.file("word/document.xml").async("string"))` temporarily in a test to inspect the XML state at each pipeline stage
- Fix the broken step

### 15.5 Handback document template

Create `docs/phases/phase-4-handback.md`:

```markdown
# Phase 4 handback — Field / hyperlink leak vectors

**Completed:** YYYY-MM-DD HH:MM
**Executed by:** Codex 5.4 xhigh
**Starting commit:** {Phase 3 HEAD short hash}
**Ending commit:** {short hash of HEAD}

## Summary

One paragraph describing the two-layer fix (flatten pre-pass + instrText
safety net + rels verify extension), number of tests added, and confirmation
that the original user bug is resolved.

## Commits created

{git log --oneline {Phase3HEAD}..HEAD}

## Files created

- src/docx/flatten-fields.ts ({N} lines)
- src/docx/flatten-fields.test.ts ({N} lines)
- docs/phases/phase-4-handback.md

## Files modified

- src/docx/redact.ts (+redactInstrText, extended redactScopeXml)
- src/docx/redact.test.ts (+10 tests)
- src/docx/redact-docx.ts (+1 pipeline call)
- src/docx/redact-docx.test.ts (+3 integration tests)
- src/docx/verify.ts (+rels scan, ~50 lines)
- src/docx/verify.test.ts (+5 tests)
- src/docx/types.ts (extended Scope with "rels" if needed)

## Tests

- Before: ~1562 passing
- After: {N} passing
- New: +{M} tests

## Build

- Before hash (Phase 3): {hash}
- After hash (Phase 4): {hash}
- Determinism: yes

## Acceptance criteria

{For each of the 23 criteria in § 15.3: ✅ or ❌ with evidence}

## Deviations from brief

{Any judgment call that differed from the brief. If none: "None."}

## Gotchas encountered

{Anything non-obvious.}

## Manual verification recommended

- [ ] Open dist/document-redactor.html
- [ ] Drop the user's pearlabyss contract (or any document with HYPERLINK fields pointing to emails)
- [ ] Check email candidate, click Apply
- [ ] Verify NO survival report OR the survival report shows `kind: "rels"` for the URL target (flatten removed the in-body instance, rels-scan flagged the orphan)
- [ ] If rels survival reported, note the path and the user's next step (manual URL removal in source Word, OR a future phase that does full rels scrub)

## Suggested next steps

1. Full rels scrub — remove orphaned rels entries OR scrub sensitive Target values. Moves Phase 4's detection into active removal.
2. Paranoid-mode extensions: embedded OLE scrub, image EXIF, hidden text, revision IDs.
3. `<w:sdt>` content control handling.
4. Math field (`<m:oMath>`) extraction if users have math-heavy contracts.
```

---

## End of brief

This document is `docs/phases/phase-4-field-leaks.md`. It specifies the two-layer fix for the field/hyperlink leak vectors surfaced during Phase 3 manual QA: a `flatten-fields.ts` pre-pass strips field machinery before detection runs, an `<w:instrText>` safety-net scrub inside redact.ts catches anything that slipped past flatten, and a `verify.ts` extension scans rels files for surviving sensitive URLs. All decisions are locked. The 9 TDD steps, 13 verification commands, and 23 acceptance criteria are the execution contract.
