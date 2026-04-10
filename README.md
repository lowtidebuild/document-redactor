# document-redactor

[![CI](https://github.com/lowtidebuild/document-redactor/actions/workflows/ci.yml/badge.svg)](https://github.com/lowtidebuild/document-redactor/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/lowtidebuild/document-redactor?color=2563eb)](https://github.com/lowtidebuild/document-redactor/releases)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-0f172a.svg)](LICENSE)
[![Bundle](https://img.shields.io/badge/bundle-~180%20KB-16a34a)](https://github.com/lowtidebuild/document-redactor/releases)
[![No network](https://img.shields.io/badge/network-0%20requests-16a34a)](#the-trust-story--four-layers-of-no-network)
[![No AI](https://img.shields.io/badge/AI-none-0f172a)](#what-it-is-what-it-isnt)

[![한국어 README](https://img.shields.io/badge/lang-한국어-2563eb)](README.ko.md)

> **A privacy-preserving, in-browser DOCX redactor for Korean + English legal documents.**
> Drop a `.docx` file. Review the detected entities and PII. Click **Apply and verify**. Download the redacted copy. Zero network requests, zero uploads, zero accounts. Runs offline in any modern browser from a single HTML file.

─────────────────────────────────────────────────────────────

## What it is, what it isn't

| ✅ What it is | ❌ What it isn't |
|---|---|
| An offline tool that runs in your browser | A cloud service |
| One HTML file (~180 KB) you download once | An installer or a native app |
| A rule-based, deterministic redactor | An AI model — there is no model, no LLM, no "magic" |
| A tool you can read the source of and verify with `sha256sum` | A black box you have to trust |
| Apache 2.0-licensed, reviewable by you or your AI assistant | Proprietary software with hidden behavior |

If someone tells you it "probably uses ChatGPT" or "sends your files somewhere for processing" — they are wrong. The whole thing is 180 KB of JavaScript, CSS, and HTML sitting on your disk. You can open it in a text editor. You can search it for the word `fetch`. You will find zero matches. That's the point.

─────────────────────────────────────────────────────────────

## Quick start

1. **Download** the latest release:
   - [`document-redactor.html`](https://github.com/lowtidebuild/document-redactor/releases/latest/download/document-redactor.html) (the tool itself, one file)
   - [`document-redactor.html.sha256`](https://github.com/lowtidebuild/document-redactor/releases/latest/download/document-redactor.html.sha256) (integrity sidecar)

2. **Verify** the download matches what was published:

   ```bash
   sha256sum -c document-redactor.html.sha256
   # expected output:
   #   document-redactor.html: OK
   ```

   If you see `OK`, the file is byte-identical to what the author shipped. If you see anything else, **stop** — something between you and GitHub modified the file. Do not run it.

3. **Open it.** Double-click the HTML file. It opens in your default browser as a `file://` URL. There is no install step, no permissions prompt, no network call. The page that loads is the whole tool.

4. **Use it.** Drop a `.docx` file onto the drop zone. Review the detected candidates in the right panel. Click **Apply and verify** (or press ⌘/Ctrl + Enter). Download the redacted file as `{yourfile}.redacted.docx`.

For a detailed walkthrough — including the candidate review model, keyboard shortcuts, troubleshooting, and how to handle non-contract documents (opinions, briefs, memos) — see **[USAGE.md](USAGE.md)**.

─────────────────────────────────────────────────────────────

## How it works (briefly)

```mermaid
flowchart LR
    subgraph browser["Your browser tab &mdash; offline, no network"]
        direction LR
        A([Drop .docx]) --> B[Parse<br/>JSZip + raw XML]
        B --> C[Detect<br/>PII regex<br/>+ your seeds]
        C --> D[/Review<br/>toggle candidates/]
        D --> E[Redact + Verify<br/>cross-run rewrite]
        E --> F([Download<br/>.redacted.docx<br/>+ SHA-256])
    end
```

Rounded caps are I/O (file in, file out). Rectangles are fully automated steps. The parallelogram is the one place a human decides anything — you review the detected candidates and toggle which ones to redact. **Everything inside the subgraph runs in your browser tab.** No network call, no server round-trip, no background worker. The tool loads the `.docx` as a zip (Word files are zips of XML), walks every text-bearing scope (body, footnotes, endnotes, comments, headers, footers), detects candidates via regex + your seeds, lets you review and toggle, then rewrites the XML in place and generates a byte-stable output with a matching SHA-256 hash.

See [USAGE.md](USAGE.md) for the step-by-step guide.

─────────────────────────────────────────────────────────────

## Why a single HTML file

One HTML file is an unusual choice in 2026. Most tools ship as web apps, desktop apps, or CLIs. Here's the case for file-based distribution:

1. **Offline by construction.** There's nothing to connect to. The moment the file loads, the tool is complete. No lazy-loaded chunks, no CDN, no font server. If your WiFi dies mid-redaction, nothing changes.

2. **Auditable in a single read.** The whole program is ~5,000 lines of generated JavaScript and CSS in one file. You can `cat` it, `grep` it, or paste it into an LLM and ask "is there anything in here that talks to the network?" The answer is verifiable in minutes.

3. **Distributable without infrastructure.** No server to maintain, no domain to renew, no account database to protect. You can email it, put it on a USB stick, share it over Kakao. Recipients verify integrity with `sha256sum`.

4. **No update surface.** The tool cannot update itself. A malicious update cannot reach you. The version you downloaded is the version you run, forever. When a new version ships, you choose whether to download it.

The trade-off is that v1 does not support features that genuinely need a server (team collaboration, shared audit logs, central policy enforcement). That's a deliberate choice — the single-file model is the product, not a limitation.

─────────────────────────────────────────────────────────────

## The trust story — four layers of "no network"

The promise is that this tool cannot phone home with your documents. That promise is enforced at four independent layers:

| Layer | Mechanism | How you verify |
|---|---|---|
| **Source code** | ESLint rule `no-restricted-syntax` bans `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator.sendBeacon`, and dynamic `import()` at every commit | `bun run lint` on a checkout of the source |
| **Bundle** | `vite.config.ts` disables the modulepreload polyfill (which would otherwise inject a `fetch()` call). Build-time ship-gate test asserts zero `fetch(` tokens, zero `XMLHttpRequest`, zero `new WebSocket` in the output HTML | `grep -c 'fetch(' document-redactor.html` → `0` |
| **Runtime** | Embedded Content-Security-Policy meta tag: `default-src 'none'; connect-src 'none'; ...`. Any attempt by the running page to open a socket is blocked by the browser before it leaves the tab | Open DevTools → Network tab → try to use the tool → observe zero requests |
| **Distribution** | Every release ships with a SHA-256 sidecar. The tool you download has a hash matching what the CI pipeline built from the tagged commit. History, diffs, and build logs are public on GitHub | `sha256sum -c document-redactor.html.sha256` |

Each layer is independent. Defeating one still leaves three in place. This is not "security theater" — the actual code-level bans are what make the tool behave as promised; the CSP is what stops a theoretical bundle-level bypass; the hash is what prevents man-in-the-middle substitution during distribution.

─────────────────────────────────────────────────────────────

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Package manager | **Bun 1.x** | Fast install, built-in TypeScript, no extra toolchain |
| Bundler | **Vite 8** | Modern DX, first-class ES modules, tight plugin ecosystem |
| UI framework | **Svelte 5** (runes mode) | Smallest runtime footprint, fine-grained reactivity, ~30 KB overhead |
| Single-file packaging | **vite-plugin-singlefile** | Inlines every JS chunk and CSS sheet into the HTML |
| DOCX parsing + mutation | **JSZip** + raw XML manipulation | No write-only libraries (`docx.js` was rejected at Gate 0 — write-only API) |
| Cross-run text handling | Custom **coalescer** module | Word splits runs like `<w:t>ABC Corpo</w:t><w:t>ration</w:t>`; the coalescer reassembles a logical text view, finds matches, then surgically rewrites only the affected runs |
| Hashing | **Web Crypto SubtleCrypto** (browser) + **node:crypto** (build) | Platform primitives, no dependencies |
| Testing | **Vitest 2** | Vite-native, fast, TypeScript-first. 422 tests in ~1.5 seconds |
| Type checking | **TypeScript 5 strict** + **svelte-check 4** | `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` |
| Linting | **ESLint 9** (flat config) | Custom `no-restricted-syntax` rules enforce the "no network" invariant at the source level |
| CI | **GitHub Actions** on `ubuntu-latest` with Bun | Free for public repos, ~40 seconds per run |

**What's deliberately absent:** no React, no web framework, no CSS-in-JS runtime, no state management library, no date-handling library, no i18n framework, no analytics, no error reporting, no telemetry, no feature flags, no A/B testing, no package lock-file checks that call out to the network.

─────────────────────────────────────────────────────────────

## Known limitations

These are not bugs — they are things v1 deliberately does not do. Most are planned for v1.x.

- **Level picker is cosmetic in v1.** Only the **Standard** rule set runs. The Conservative and Paranoid options are UI stubs. Planned for v1.1.
- **No click-to-select in the document preview.** The preview pane is a placeholder explaining that candidate review happens in the right panel. A full WordprocessingML → HTML renderer is a separate module-scale effort planned for v1.1 or v1.2.
- **View source + Audit log buttons are disabled.** Tooltips explain each. Planned for v1.1 (the self-hash modal will compare the running file against the published release hash).
- **Layout degrades to 2-column below 720 px.** The 3-column desktop layout needs ≥1024 px to feel comfortable.
- **No OCR.** If your DOCX contains images of text (scanned PDFs imported to Word), the text inside those images is not processed. The tool handles text runs, not pixels.
- **No embedded object traversal.** OLE-embedded Excel/PowerPoint objects are not walked into. Table cells in native DOCX tables **are** handled.
- **No SmartArt or WordArt text.** These are special OOXML constructs outside v1's scope.
- **Tested primarily against bilingual contracts.** The engine is text-based and works on any DOCX, but v1's fixture corpus is contract-focused. Opinions, briefs, memos, and internal notes all work in practice — see [USAGE.md](USAGE.md#non-contract-documents) for guidance.

─────────────────────────────────────────────────────────────

## For developers

```bash
git clone https://github.com/lowtidebuild/document-redactor.git
cd document-redactor
bun install
bun run dev         # Vite dev server on 127.0.0.1:5173
bun run test        # 422 tests, ~1.5s
bun run typecheck   # tsc --noEmit + svelte-check
bun run lint        # ESLint (enforces the no-network invariant)
bun run build       # Produces dist/document-redactor.html + .sha256
```

The test suite runs a real `vite build` as part of the ship-gate check, so `bun run test` is the most comprehensive single command — it exercises the engine, the UI logic, and the production build end-to-end.

Source layout:

```
src/
├── detection/      PII regex sweep + keyword suggester
├── docx/           DOCX I/O: coalescer, scope walker, redactor, verifier
├── finalize/       SHA-256 + word-count sanity + ship-gate orchestrator
├── propagation/    Variant propagation + defined-term classifier
└── ui/             Svelte 5 components + state machine + engine wrapper
```

─────────────────────────────────────────────────────────────

## Inspiration

Inspired by [Tan Sze Yao's Offline-Redactor](https://thegreatsze.github.io/Offline-Redactor/).

─────────────────────────────────────────────────────────────

## License

[Apache License 2.0](LICENSE). Use it, modify it, redistribute it, sell it — subject to the terms in the LICENSE file, which include a patent grant and require retaining the copyright and attribution notices.

─────────────────────────────────────────────────────────────

_Built by [@lowtidebuild](https://github.com/lowtidebuild)._
