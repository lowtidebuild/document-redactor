# Usage Guide

A step-by-step walkthrough for running `document-redactor` on a real file. If you haven't downloaded the tool yet, start with the [README Quick Start](README.md#quick-start).

---

## Table of contents

1. [Getting the file](#1-getting-the-file)
2. [Verifying your download](#2-verifying-your-download)
3. [Opening the tool](#3-opening-the-tool)
4. [Your first redaction](#4-your-first-redaction)
5. [Understanding the three candidate groups](#5-understanding-the-three-candidate-groups)
6. [The D9 defined-term policy](#6-the-d9-defined-term-policy)
7. [Non-contract documents](#non-contract-documents)
8. [Keyboard shortcuts](#7-keyboard-shortcuts)
9. [Verifying your output](#8-verifying-your-output)
10. [Troubleshooting](#9-troubleshooting)
11. [What this tool doesn't do](#10-what-this-tool-doesnt-do)
12. [Privacy statement](#11-privacy-statement)

---

## 1. Getting the file

Go to the [latest release](https://github.com/lowtidebuild/document-redactor/releases/latest) and download **both** files:

- **`document-redactor.html`** — the tool itself (one HTML file, ~180 KB)
- **`document-redactor.html.sha256`** — the integrity sidecar (89 bytes)

If you received the files via Kakao, email, or USB from someone else, that's fine — the verification step in the next section is exactly designed for this case. You don't need to trust the sender; you need to verify the hash.

---

## 2. Verifying your download

The sidecar file lets you prove that what you have is byte-identical to what was published. This matters because between the official release and your disk, a file can be modified by:

- A compromised mirror
- A corporate proxy or DLP system that transparently rewrites downloads
- A malicious network intermediary
- A well-meaning sender who accidentally re-exported or re-zipped the file

All of these scenarios produce a different SHA-256 hash. The verification is a one-line command.

### macOS / Linux

```bash
cd /path/to/where/you/downloaded/both/files
sha256sum -c document-redactor.html.sha256
```

Expected output:

```
document-redactor.html: OK
```

On older macOS without `sha256sum`, use:

```bash
shasum -a 256 -c document-redactor.html.sha256
```

### Windows (PowerShell)

```powershell
cd C:\path\to\where\you\downloaded\both\files

# Compute the hash of the downloaded HTML
$actual = (Get-FileHash -Algorithm SHA256 document-redactor.html).Hash.ToLower()

# Read the expected hash from the sidecar
$expected = (Get-Content document-redactor.html.sha256).Split(' ')[0].ToLower()

if ($actual -eq $expected) { "OK" } else { "MISMATCH — do not run" }
```

### Windows (WSL / Git Bash)

Same as macOS / Linux:

```bash
sha256sum -c document-redactor.html.sha256
```

### If you see anything other than `OK`

**Stop.** Do not open the HTML file. The file you have is not the file that was published. Possible next steps:

1. Re-download both files directly from the GitHub releases page (browser address bar, not a link someone sent you).
2. Verify on a different network (your corporate proxy may be rewriting the file).
3. Report the mismatch to the author via a GitHub issue.

---

## 3. Opening the tool

Double-click `document-redactor.html`. Your default browser opens it as a `file://` URL. There is no installer, no permissions prompt, no network call, no toolbar extension.

The title bar (or tab title) should read `document-redactor · offline DOCX redactor`. The top-left brand area says `document-redactor`. The top-right badge says `0 network requests` — and means it.

### Which browsers work

- Chrome, Chromium, Brave, Edge (v120+) — tested
- Firefox (v120+) — tested
- Safari (16+) — tested
- Any modern browser with support for ES2022, Web Crypto SubtleCrypto, and `file://` origins

### Which browsers don't work

- Internet Explorer (any version)
- Very old Safari (<16)
- Mobile browsers with restrictive file APIs — technically loads but the drop-zone UX is awkward on phones

---

## 4. Your first redaction

Let's walk through redacting a contract step by step.

### Step 4.1 — Drop your file

You'll see a large dashed rectangle labeled "Drop a DOCX file here, or choose a file." Drag a `.docx` from your file explorer onto the rectangle, or click the "choose a file" link and pick one.

The tool loads the file, unzips it in memory, walks every text-bearing scope (body, footnotes, endnotes, comments, headers, footers), and advances to the next phase. This takes under a second for typical contracts.

> **Nothing leaves your machine.** The file lives in a JavaScript variable inside your browser tab. Nothing is uploaded, cached to disk, or sent to a server — there is no server to send it to.

### Step 4.2 — Fill in the seed editor (left sidebar)

The sidebar on the left shows a **Seed editor**. This is where you tell the tool which names and phrases you want to find and redact.

By default, it contains a few example seeds (company names, person names). **Replace them with your actual targets.** One entry per line. Examples:

```
ABC Corporation
XYZ Holdings
김철수
Jane Smith
010-1234-5678
```

The seed editor is for **custom entities** — things the tool cannot guess (company names, specific individuals, specific addresses). Known PII patterns (phones, emails, 주민번호, 사업자번호, etc.) are detected automatically by the PII regex sweep; you don't need to add them here.

### Step 4.3 — Review the candidate panel (right)

After dropping the file, the right panel shows **three groups** of candidates:

1. **Literal names** — Every variant of every seed you entered. If you typed `ABC Corporation`, you'll see rows for `ABC Corporation`, `ABC Corp`, `ABC`, and any other substring the tool extracted.
2. **Defined term labels** — Role words and aliases the tool detected as contract definitions (`the Buyer`, `the Discloser`, `甲`, `매수인`, etc.). These are **unchecked by default** — see [§ 6 The D9 defined-term policy](#6-the-d9-defined-term-policy).
3. **Auto-detected PII** — Every phone, email, 주민등록번호, 사업자등록번호, EIN, bank account, credit card number the regex sweep found.

Each row has a checkbox. Everything in groups 1 and 3 is **checked by default**. Everything in group 2 is **unchecked by default**. You can toggle any checkbox freely.

### Step 4.4 — Press Apply

When you're happy with the selections, click **Apply and verify** at the bottom of the panel (or press **⌘/Ctrl + Enter** from anywhere).

The tool:

1. Rewrites the XML in place, replacing every selected candidate with `[REDACTED]`.
2. Runs a verification pass — re-reads the output bytes and confirms zero occurrences of any selected target remain.
3. Computes the SHA-256 hash of the output file.
4. Checks the word count against the original (a ≥30% drop flags as suspicious).
5. Shows a green banner: **"Verification passed"** with the SHA-256 (first 4 + last 4 hex chars) and the word count before/after.

### Step 4.5 — Download

Click **Download** on the green banner. The file saves as `{your original filename}.redacted.docx`. For example, `NDA_2026_final.docx` becomes `NDA_2026_final.redacted.docx`.

This is the file you ship. You can open it in Word, Google Docs, or any other editor, and the redacted spans appear as `[REDACTED]` inline with the rest of the text.

---

## 5. Understanding the three candidate groups

### Group 1 — Literal names (red pills)

Everything in this group comes from your seed editor entries and their **automatic variants**. If you entered `ABC Corporation`, the tool proposes:

- `ABC Corporation` (the seed itself)
- `ABC Corp` (corporate suffix swap)
- `ABC` (bare root)
- Any other substring pattern that matches corporate-naming conventions

**These are checked by default** because they are the entities you explicitly asked to redact.

**Careful with bare roots.** If `ABC` is checked and your document also contains the word `abc` as part of another entity (like `abcdefg Co.`), the bare root will match it too. Deselect `ABC` if you want only the full-name form redacted.

### Group 2 — Defined term labels (slate pills)

These are role words and definition aliases the tool detected by looking for patterns like:

- `"Discloser" means ABC Corporation` → the label `Discloser` gets grouped here
- `(hereinafter "the Buyer")` → `the Buyer`
- 한국어: `("갑"이라 함은 ABC 법인을 말한다)` → `갑`
- Japanese-style: `甲`, `乙`

**These are unchecked by default** — because if you redact them, sentences like `The Buyer acknowledges that the Discloser may disclose…` become `The [REDACTED] acknowledges that the [REDACTED] may disclose…`, which loses readability and downstream AI tools cannot reason about party roles. See [§ 6](#6-the-d9-defined-term-policy) for when you should turn them on.

### Group 3 — Auto-detected PII (amber pills)

Every hit from the PII regex sweep:

- 주민등록번호 (Korean RRN, format `XXXXXX-Xxxxxxx`)
- 사업자등록번호 (Korean business registration, format `XXX-XX-XXXXX`)
- EIN (US Employer Identification Number, format `XX-XXXXXXX`)
- Phone numbers (Korean, international)
- Email addresses
- Bank account numbers (Korean)
- Credit card numbers (Luhn-validated)

**These are checked by default.** Each row shows its detected kind (e.g., `주민등록번호`, `phone · KR`, `email`).

**The PII regex sweep is deterministic.** No ML, no probabilistic scoring. If a string matches the pattern, it appears here. If it doesn't match, it doesn't. The patterns are strict — a random 13-digit number will not show up as "probably a 주민번호" unless it actually fits the format.

---

## 6. The D9 defined-term policy

In a typical two-party contract, the definition section says something like:

> This Agreement is made between ABC Corporation ("Discloser") and XYZ Holdings ("Recipient").

After this sentence, the rest of the contract refers to the parties as "the Discloser" and "the Recipient" instead of their full names. If you redact both the full names AND the defined terms, every reference disappears:

> `The [REDACTED] agrees that [REDACTED] may share information with [REDACTED] employees…`

That's not useful. The whole point of redacting is to hand the file to a downstream reader (another lawyer, an AI tool, a non-NDA counterparty) who can still reason about the structure of the agreement. Keeping the role labels intact preserves readability:

> `The Discloser agrees that Recipient may share information with Recipient employees…`

This is why defined terms are **unchecked by default**.

### When to turn defined terms ON

You should check defined term boxes when:

1. **Three or more parties share the same role.** If three companies are all "Licensees", leaving `Licensee` unredacted doesn't hide anything — the role word is generic. But if two of them are called `Licensee A` and `Licensee B`, then redacting only the full names (while keeping `Licensee A` / `Licensee B` intact) might leak who-is-who by elimination.
2. **Your output is going to an adversarial reader.** If the recipient might try to de-anonymize by cross-referencing external data, removing all labels is safer than preserving structure.
3. **You're sharing a public record.** For court filings where the party names must be obscured but the document structure must remain intact, leave defined terms on and let the reader rely on context.

### When to keep defined terms OFF (the default)

For the common case — sending a contract to an in-house colleague, another attorney, or a legal AI tool for analysis — leaving defined terms unredacted is the right call. The downstream reader sees the contract structure clearly and can focus on the legal analysis instead of decoding `[REDACTED]`.

### How to read the labels

Each defined term row shows its **source attribution** underneath: `from definition · ABC Corporation`. This tells you which entity the label refers to, so you can make per-label decisions.

---

## Non-contract documents

The engine is text-based and works on any DOCX — it doesn't know or care whether the file is a contract, an opinion, a brief, a memo, or internal notes. For non-contract use:

- **Enter your targets in the seed editor.** The tool cannot guess what you want to redact in a judge's opinion (case numbers? party names? judge's name?). Type them in.
- **Defined term detection will find nothing.** The D9 parser looks for `"X" means Y` and `("Y"이라 함은)` patterns, which are almost exclusive to contracts. On a non-contract document, the defined-term group will be empty — that's correct.
- **PII regex sweep still works.** 주민번호, phones, emails, 사업자번호 — all detected regardless of document type.
- **Stop-phrases are contract-flavored.** The internal stop-phrase list (noise words the keyword suggester skips) includes contract skeleton terms like "제1조", "본 계약", "갑", "을". These won't cause false positives — they're used to filter out the *suggestion* sidebar, not the detection. You can safely ignore this.

**Practical example — redacting a judgment excerpt:**

1. Seed editor:
   ```
   김철수
   박영희
   ABC 법인
   서울중앙지방법원 2024가합12345
   ```
2. The PII sweep may find phone numbers, 주민번호, or 사업자번호 in the text of the judgment. Those show up in group 3.
3. The defined-term group is empty (no `"X" means Y` in a judgment).
4. Apply → verify → download.

---

## 7. Keyboard shortcuts

- **⌘ (Mac) / Ctrl (Windows, Linux) + Enter** — Fire "Apply and verify" when you're in the post-parse phase. Works from anywhere on the page, no focus management needed.

That's the full shortcut list for v1. More may arrive in v1.x — follow the releases page.

---

## 8. Verifying your output

After a successful redaction, the green banner shows the SHA-256 of your output file (first 4 + last 4 hex). You can independently verify this hash in a terminal:

```bash
sha256sum NDA_2026_final.redacted.docx
```

The first 4 + last 4 hex chars should match what the banner showed. If they don't, something is wrong — file a bug.

### Why hash the output?

Because if you send the redacted file to someone else and want them to confirm they received the same file you sent, the hash is the contract. Same hash = byte-identical file. Different hash = something changed in transit (email re-encoding, zip re-compression, corporate DLP rewriting).

### Is the hash deterministic across runs?

**Yes, for the same input + same selections.** The tool pins every zip entry's internal timestamp to Unix epoch 0 before generating the output zip. This means:

- Run the tool twice on the same input with the same toggle choices → byte-identical output → identical SHA-256.
- Two different people running the tool on the same input with the same selections → identical SHA-256.

This is what makes the Kakao-message distribution path work: you can say "here is the hash of the file I'm about to send you" and the recipient can verify that what they received is what you sent.

---

## 9. Troubleshooting

### "The file I dropped just shows a spinner forever"

The parse phase is synchronous and fast (<1 second). If it appears stuck:

1. Open browser DevTools (F12) → Console tab. Look for errors.
2. Check whether the file is actually a `.docx`. The tool rejects `.doc` (legacy binary format), `.pages`, and other non-OOXML files.
3. Very large files (>10 MB) may take a few seconds — wait before declaring it stuck.
4. If none of the above: file a bug with the error from the console and a fixture that reproduces the problem (a synthetic minimal DOCX, not your real file).

### "A name I expected to see isn't in the candidate list"

First, check that you actually typed it in the seed editor. The tool finds only:

- Literal seeds you entered (and their automatic variants)
- Defined term patterns (`"X" means Y` format)
- PII patterns (regex — phones, emails, 주민번호, 사업자번호, etc.)

If you expected a specific company name to be found automatically, it won't be — there is no "proper noun detection" in v1 (that would require an ML model, which we don't have). Add it to the seed editor and re-drop the file.

### "The tool found 주민번호 where there isn't one"

Unlikely but possible — the regex is strict but not infallible. Check the position in the text. Common false positives:

- A long ID like `2024041012345678` that happens to have 13 digits — the regex is anchored to `[0-9]{6}-[1-4][0-9]{6}` with the hyphen and the 7th-digit constraint, so this should NOT match. Report it as a bug if it does.
- A date like `2024-01-15` formatted as `240115` — does not match the 주민번호 pattern.

If you see a false positive that seems to actually fit the pattern, uncheck that row before applying.

### "The verification step failed"

The banner turns red: **"Verification FAILED — N occurrences remain"**. This means after redacting, the verifier re-read the output and still found targets. This should never happen on well-formed DOCX and indicates a bug.

Workaround: deselect the specific target that survived, re-run, and **file a bug** with:
- The DOCX fixture that reproduces (or a minimal synthesized one)
- The list of selected targets
- The SHA-256 of the input file

### "The tool is slow"

Parse takes ~200ms. Detection takes ~300ms for a typical contract. Apply takes ~500ms plus write-back. Total: under 2 seconds end to end.

If it's genuinely slow (>10 seconds), the most likely cause is a very large DOCX with many thousands of paragraphs. Open DevTools Performance tab to profile. File a bug with the fixture size.

### "I dropped a 50 MB file and my browser hung"

The tool has no explicit size cap in v1, but browsers start to choke on multi-hundred-MB files held entirely in memory. Typical legal documents are <5 MB. If your file is unusually large (scanned PDF converted to DOCX with embedded images, for example), the OCR / image caveat from [§ 10](#10-what-this-tool-doesnt-do) applies — the tool can't redact text inside images regardless, so there's no benefit to running it on an image-heavy file.

### "The mobile version looks weird"

Below 720 px, the 3-column layout degrades to 2-column. Below 400 px, things start to overlap. The tool is intended for desktop use in v1. Mobile polish is not on the v1.x roadmap.

### "I want to undo a redaction"

You can't — the output file has `[REDACTED]` baked in. But you can:

1. Go back to the drop zone
2. Drop the ORIGINAL file again (the tool keeps no state between parses)
3. Deselect the targets you now want to keep
4. Apply again

The tool never modifies the original input file on disk; it only reads it.

---

## 10. What this tool doesn't do

These are v1 limitations. Most are planned for v1.x.

- **No OCR.** If your DOCX has images of text (scanned pages, screenshots of other documents), the text inside those images is invisible to the tool. You must redact them in an image editor before importing to Word, or use a separate OCR pipeline.

- **No handwritten signature images.** Same as OCR — they're pixels, not text.

- **No SmartArt or WordArt text.** These are special OOXML constructs. Text inside them is not walked by the scope walker in v1. If you use these features, verify manually after export.

- **No embedded Excel / PowerPoint objects.** OLE-embedded objects are treated as opaque blobs. Native DOCX tables (regular Word tables) are **fully handled**.

- **No form fields or content controls.** Microsoft Word supports structured document tags (`<w:sdt>`) for form fields. v1 treats these as text runs for text purposes but does not understand the field semantics.

- **No macros or VBA.** `.docm` files (macro-enabled Word) are not supported in v1. Convert to `.docx` first.

- **No click-to-select in the preview pane.** The preview shows the loaded file name and a placeholder; candidate review happens entirely in the right panel.

- **No undo / redo inside the tool.** Each "Apply" is one-shot. To change your mind, go back to the drop zone and re-drop the original file.

- **No persistent state between sessions.** The tool remembers nothing. Close the tab, reopen it, and you start fresh.

- **No batch processing.** One file at a time. For bulk redaction, run the tool once per file.

- **No policy files / team sharing.** Every user maintains their own seed list. No import/export of seeds in v1.

---

## 11. Privacy statement

**We collect nothing because there is no "we".**

`document-redactor` is an HTML file. It runs inside your browser tab, on your computer, from your disk. It has no backend. There is no database to which your data could be written. There is no analytics endpoint. There is no error reporting service. There is no "usage telemetry." There is no feature flag service. The tool cannot contact the outside world because:

1. The source code has no `fetch`, `XMLHttpRequest`, `WebSocket`, or any other network API call.
2. The built HTML has been scanned at build time to confirm zero such tokens in the bundle.
3. The runtime Content-Security-Policy blocks any such call even if one existed.
4. You can verify all three above yourself before running it.

When you redact a file with this tool, the file you dropped, the seed list you typed, the selection states you toggled, and the output file you downloaded — all of it exists only in your browser tab's memory and on your disk. When you close the tab, all of it is gone.

If you find any behavior that contradicts this statement, it is a bug, and it would be the single most important bug in the project. Please file an issue immediately.

---

_That's the full v1 guide. For the design rationale and trust architecture, see the [README](README.md). For bug reports and feature requests, use [GitHub Issues](https://github.com/lowtidebuild/document-redactor/issues)._
