<!--
  Top-level Svelte 5 component — the entire app.

  This is the **minimal bootstrap** that proves the build pipeline is
  working end-to-end: Svelte 5 runes compile, Vite bundles, the bundle
  survives the CSP meta tag, and `finalizeRedaction` (the Lane D
  orchestrator) is reachable from the UI layer.

  It is NOT the real UI. The real UI (Lane E) will replace this file
  with a proper state machine + layout from the mocks. What this does:

    1. Shows a drop zone.
    2. When a .docx is dropped, loads it with JSZip.
    3. Builds a target list from Lane A + Lane C.
    4. Runs `finalizeRedaction` (Lane D).
    5. Shows the verify + sanity + SHA-256 result.
    6. If shippable, offers a download button for the output bytes.

  That's it. No styling beyond a reset + basic typography. The point is
  to verify the full engine → UI path works before we start polishing.
-->
<script lang="ts">
  import JSZip from "jszip";

  import { buildTargetsFromZip as buildPiiTargets } from "../detection/detect-pii.js";
  import { extractTextFromZip } from "../detection/extract-text.js";
  import {
    finalizeRedaction,
    isShippable,
    type FinalizedReport,
  } from "../finalize/finalize.js";
  import { parseDefinitionClauses } from "../propagation/definition-clauses.js";
  import {
    buildRedactionTargets,
    propagateVariants,
  } from "../propagation/propagate.js";

  type AppStatus = "idle" | "parsing" | "ready" | "error";

  let status = $state<AppStatus>("idle");
  let fileName = $state<string | null>(null);
  let report = $state<FinalizedReport | null>(null);
  let errorMessage = $state<string | null>(null);
  /** Manually entered entity seeds (one per line). */
  let seedInput = $state<string>(
    [
      "ABC Corporation",
      "Sunrise Ventures LLC",
      "ABC 주식회사",
      "김철수",
      "이영희",
      "Project Falcon",
      "블루윙 2.0",
    ].join("\n"),
  );

  async function handleFile(file: File): Promise<void> {
    status = "parsing";
    fileName = file.name;
    report = null;
    errorMessage = null;

    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const zip = await JSZip.loadAsync(buf);

      // Lane A: PII regex sweep.
      const piiTargets = await buildPiiTargets(zip);

      // Lane C: variant propagation from the user's entity seeds.
      const seeds = seedInput
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const corpus = (await extractTextFromZip(zip))
        .map((s) => s.text)
        .join("\n");
      const clauses = parseDefinitionClauses(corpus);
      const groups = seeds.map((seed) =>
        propagateVariants(seed, corpus, clauses),
      );
      const entityTargets = buildRedactionTargets(groups);

      const targets = [...new Set([...piiTargets, ...entityTargets])];

      // Lane D: finalize.
      const result = await finalizeRedaction(zip, { targets });
      report = result;
      status = "ready";
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      status = "error";
    }
  }

  function onDrop(e: DragEvent): void {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file !== undefined) {
      void handleFile(file);
    }
  }

  function onDragOver(e: DragEvent): void {
    e.preventDefault();
  }

  function onPick(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file !== undefined) {
      void handleFile(file);
    }
  }

  function downloadOutput(): void {
    if (report === null) return;
    // Copy into a plain ArrayBuffer so Blob never sees SharedArrayBuffer.
    const bytes = report.outputBytes.slice();
    const blob = new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = outputFilename();
    a.click();
    URL.revokeObjectURL(url);
  }

  function outputFilename(): string {
    if (fileName === null) return "redacted.docx";
    const dot = fileName.lastIndexOf(".");
    const stem = dot === -1 ? fileName : fileName.slice(0, dot);
    const ext = dot === -1 ? "docx" : fileName.slice(dot + 1);
    return `${stem}.redacted.${ext}`;
  }
</script>

<main class="shell">
  <header class="topbar">
    <div class="brand">document-redactor</div>
    <div class="badge badge--offline">0 network requests · offline</div>
  </header>

  <section class="hero">
    <h1>Offline DOCX redactor</h1>
    <p class="subhead">
      Single HTML file · runs from <code>file://</code> · no install, no AI,
      no telemetry
    </p>
  </section>

  <section class="grid">
    <aside class="sidebar">
      <label class="label" for="seeds">Entity seeds (one per line)</label>
      <textarea id="seeds" class="seeds" rows="8" bind:value={seedInput}
      ></textarea>
      <p class="hint">
        Company names, person names, product/code names. Lane A handles PII
        (emails, phones, 주민번호) automatically.
      </p>
    </aside>

    <section class="main-panel">
      {#if status === "idle"}
        <div
          class="dropzone"
          role="button"
          tabindex="0"
          ondrop={onDrop}
          ondragover={onDragOver}
        >
          <p class="dropzone__title">Drop a .docx file here</p>
          <p class="dropzone__hint">
            or
            <label class="filepick">
              <input type="file" accept=".docx" onchange={onPick} />
              <span>choose a file</span>
            </label>
          </p>
        </div>
      {:else if status === "parsing"}
        <div class="status">
          <p>Parsing {fileName}…</p>
        </div>
      {:else if status === "error"}
        <div class="status status--error">
          <p><strong>Error:</strong> {errorMessage}</p>
          <button
            type="button"
            onclick={() => {
              status = "idle";
              errorMessage = null;
            }}
          >
            Try another file
          </button>
        </div>
      {:else if status === "ready" && report !== null}
        <div
          class="status status--{isShippable(report) ? 'ok' : 'fail'}"
        >
          <h2>
            {isShippable(report)
              ? "✓ Download ready"
              : "✗ Blocked — review survivals"}
          </h2>
          <dl class="report">
            <dt>Verify</dt>
            <dd>
              {report.verify.isClean
                ? `clean · ${report.verify.scopesChecked} scopes, ${report.verify.stringsTested} strings tested`
                : `FAILED · ${report.verify.survived.length} survivals`}
            </dd>
            <dt>Word count</dt>
            <dd>
              {report.wordCount.before} → {report.wordCount.after} ({report
                .wordCount.droppedPct}% dropped, threshold {report.wordCount
                .thresholdPct}%)
            </dd>
            <dt>SHA-256</dt>
            <dd class="mono">{report.sha256}</dd>
            <dt>Size</dt>
            <dd>{(report.outputBytes.length / 1024).toFixed(1)} KB</dd>
          </dl>

          {#if isShippable(report)}
            <button
              class="btn btn--primary"
              type="button"
              onclick={downloadOutput}
            >
              Download {outputFilename()}
            </button>
          {:else}
            <details>
              <summary>Survived strings ({report.verify.survived.length})</summary>
              <ul>
                {#each report.verify.survived as s (s.text + s.scope.path)}
                  <li>
                    <code>{s.text}</code> × {s.count} in
                    <code>{s.scope.path}</code>
                  </li>
                {/each}
              </ul>
            </details>
          {/if}

          <button
            type="button"
            class="btn"
            onclick={() => {
              status = "idle";
              report = null;
              fileName = null;
            }}
          >
            Start over
          </button>
        </div>
      {/if}
    </section>
  </section>
</main>

<style>
  :global(html, body) {
    margin: 0;
    padding: 0;
    background: #f8fafc;
    color: #0f172a;
    font-family:
      system-ui,
      -apple-system,
      "Apple SD Gothic Neo",
      "Noto Sans KR",
      sans-serif;
    font-size: 14px;
    line-height: 1.5;
  }

  .shell {
    max-width: 1080px;
    margin: 0 auto;
    padding: 24px;
  }

  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 16px;
    border-bottom: 1px solid #e2e8f0;
  }

  .brand {
    font-weight: 700;
    letter-spacing: -0.01em;
    color: #0f172a;
  }

  .badge {
    font-size: 12px;
    padding: 4px 10px;
    border-radius: 999px;
    background: #ecfdf5;
    color: #047857;
    border: 1px solid #a7f3d0;
  }

  .hero {
    padding: 24px 0 16px;
  }

  .hero h1 {
    margin: 0;
    font-size: 22px;
    letter-spacing: -0.01em;
  }

  .subhead {
    margin: 6px 0 0;
    color: #475569;
  }

  .grid {
    display: grid;
    grid-template-columns: 260px 1fr;
    gap: 24px;
    padding-top: 16px;
  }

  @media (max-width: 720px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }

  .sidebar {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 16px;
  }

  .label {
    font-size: 12px;
    font-weight: 600;
    color: #475569;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .seeds {
    width: 100%;
    margin-top: 6px;
    padding: 8px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 13px;
    resize: vertical;
    box-sizing: border-box;
  }

  .hint {
    font-size: 12px;
    color: #64748b;
    margin: 8px 0 0;
  }

  .main-panel {
    min-height: 300px;
  }

  .dropzone {
    background: #ffffff;
    border: 2px dashed #cbd5e1;
    border-radius: 12px;
    padding: 56px 24px;
    text-align: center;
    transition: border-color 120ms ease;
    cursor: pointer;
  }

  .dropzone:hover {
    border-color: #2563eb;
    background: #eff6ff;
  }

  .dropzone__title {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }

  .dropzone__hint {
    margin: 8px 0 0;
    color: #64748b;
  }

  .filepick input {
    display: none;
  }

  .filepick span {
    color: #2563eb;
    text-decoration: underline;
    cursor: pointer;
  }

  .status {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 24px;
  }

  .status--ok {
    border-color: #10b981;
    background: #ecfdf5;
  }

  .status--fail {
    border-color: #ef4444;
    background: #fef2f2;
  }

  .status--error {
    border-color: #ef4444;
    background: #fef2f2;
  }

  .status h2 {
    margin: 0 0 12px;
  }

  .report {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 16px;
    margin: 0 0 16px;
  }

  .report dt {
    font-weight: 600;
    color: #475569;
  }

  .report dd {
    margin: 0;
    color: #0f172a;
  }

  .mono {
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 12px;
    word-break: break-all;
  }

  .btn {
    display: inline-block;
    padding: 8px 16px;
    margin-right: 8px;
    border: 1px solid #cbd5e1;
    background: #ffffff;
    border-radius: 6px;
    font-size: 14px;
    cursor: pointer;
  }

  .btn--primary {
    background: #2563eb;
    color: #ffffff;
    border-color: #2563eb;
  }

  .btn--primary:hover {
    background: #1d4ed8;
  }
</style>
