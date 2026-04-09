/**
 * Gate 0 JSZip pipeline smoke test (final form).
 *
 * History: this file started as a from-scratch reproduction of the redaction
 * pipeline so we could prove (against the worst-case bilingual NDA fixture)
 * that JSZip + raw XML manipulation could pass all 7 Gate 0 checklist items.
 * That validation succeeded — see the original commit history if you want to
 * see the inline implementation.
 *
 * After the validation, every operation in this spike was extracted into
 * tested production modules under `src/docx/`:
 *   - src/docx/scopes.ts             (listScopes, readScopeXml)
 *   - src/docx/coalesce.ts           (text run coalescer)
 *   - src/docx/flatten-track-changes.ts
 *   - src/docx/strip-comments.ts
 *   - src/docx/scrub-metadata.ts
 *   - src/docx/redact.ts             (cross-run substitution via coalescer)
 *   - src/docx/verify.ts             (round-trip safety net)
 *   - src/docx/redact-docx.ts        (orchestrator)
 *
 * Each module has its own unit tests, and `src/docx/redact-docx.test.ts`
 * runs the entire orchestrator against this same fixture as part of the
 * test suite.
 *
 * What this spike still does:
 *   1. Calls the production orchestrator on the worst-case bilingual fixture
 *   2. Writes the output to spike/out/bilingual_nda_worst_case.redacted.docx
 *      so a human can open it in Microsoft Word and visually verify (this is
 *      Gate 0 item #7 — "Word reopen produces no 'repair needed' dialog" —
 *      the only check we cannot fully automate without LibreOffice or Word).
 *   3. Prints a human-readable progress report.
 *
 * Run:
 *   bun spike/jszip-spike.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import JSZip from "jszip";

import { redactDocx } from "../src/docx/redact-docx.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const FIXTURE = path.join(
  REPO_ROOT,
  "tests/fixtures/bilingual_nda_worst_case.docx",
);
const OUT_DIR = path.join(REPO_ROOT, "spike/out");
const OUT_FILE = path.join(OUT_DIR, "bilingual_nda_worst_case.redacted.docx");

// Same redaction list as the test, kept here for the manual visual run.
const REDACTIONS: readonly string[] = [
  "ABC Corporation",
  "ABC Corp",
  "ABC 주식회사",
  "Sunrise Ventures LLC",
  "Sunrise Ventures",
  "kim@abc-corp.kr",
  "legal@sunrise.com",
  "010-1234-5678",
  "+1 415 555 0199",
  "123-45-67890",
  "EIN 12-3456789",
  "김철수",
  "이영희",
  "Project Falcon",
  "블루윙 2.0",
] as const;

function header(s: string): void {
  console.log(`\n${"═".repeat(72)}`);
  console.log(`  ${s}`);
  console.log(`${"═".repeat(72)}`);
}

async function main(): Promise<number> {
  if (!fs.existsSync(FIXTURE)) {
    console.error(`Fixture not found: ${FIXTURE}`);
    console.error(`Run: python3 tools/make-fixture.py`);
    return 1;
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  header("GATE 0 JSZip pipeline smoke test (production orchestrator)");
  console.log(`  Fixture: ${path.relative(REPO_ROOT, FIXTURE)}`);
  console.log(`  Size:    ${(fs.statSync(FIXTURE).size / 1024).toFixed(1)} KB`);
  console.log(`  Targets: ${REDACTIONS.length} sensitive strings`);

  // ── Load → run the production orchestrator → save ──────────────────────
  header("STEP 1: Load DOCX into JSZip");
  const buf = fs.readFileSync(FIXTURE);
  const zip = await JSZip.loadAsync(buf);
  console.log(`  ✓ loaded ${(buf.length / 1024).toFixed(1)} KB`);

  header("STEP 2: Run redactDocx() — full pipeline");
  const report = await redactDocx(zip, { targets: REDACTIONS });

  console.log(`\n  Per-scope mutation summary:`);
  for (const m of report.scopeMutations) {
    console.log(
      `    ${m.scope.path.padEnd(28)} ${String(m.bytesBefore).padStart(6)} → ${String(m.bytesAfter).padStart(6)} bytes  (${m.scope.kind})`,
    );
  }

  header("STEP 3: Round-trip verification (safety net)");
  if (report.verify.isClean) {
    console.log(
      `  ✓ verify clean — 0 sensitive strings survived across ${report.verify.scopesChecked} scopes`,
    );
    console.log(`    (${report.verify.stringsTested} unique targets tested)`);
  } else {
    console.log(`  ✗ verify FAILED — ${report.verify.survived.length} survivals:`);
    for (const s of report.verify.survived) {
      console.log(
        `      '${s.text}' × ${s.count} in ${s.scope.path}`,
      );
    }
    return 2;
  }

  header("STEP 4: Save output DOCX");
  const out = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  fs.writeFileSync(OUT_FILE, out);
  console.log(`  ✓ wrote ${path.relative(REPO_ROOT, OUT_FILE)}`);
  console.log(`    size: ${(out.length / 1024).toFixed(1)} KB`);

  header("VERDICT: GO — orchestrator pipeline passes the worst-case fixture");
  console.log("");
  console.log("  Manual verification still required (one-time, then automated):");
  console.log(
    "    Open spike/out/bilingual_nda_worst_case.redacted.docx in Microsoft Word.",
  );
  console.log("    There must be NO 'needs repair' dialog. The visible body should");
  console.log("    contain [REDACTED] markers in place of company names, emails,");
  console.log("    phone numbers, person names, and product/code names. Defined");
  console.log(
    "    terms ('the Buyer', '매수인') and Korean Unicode probes (甲 乙 📼) must",
  );
  console.log("    survive.");
  console.log("");
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
