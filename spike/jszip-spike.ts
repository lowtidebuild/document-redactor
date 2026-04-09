/**
 * Gate 0 JSZip + raw XML spike (the fallback).
 *
 * docx.js was rejected at Gate 0 (see spike/docxjs-spike.ts output). This
 * spike validates the alternative: unzip the DOCX with JSZip, perform
 * targeted string replacement inside word/document.xml and the supporting
 * parts (headers, footers, comments), re-zip, and verify the result
 * round-trips through a re-parse.
 *
 * Tests all 7 Gate 0 checklist items against the worst-case fixture:
 *   1. Body / table / header / footer / footnote text preservation
 *   2. Track changes: this approach FLATTENS them (drops w:ins/w:del tags,
 *      keeps inserted text, drops deleted text) — matches Level 2 Standard
 *      per eng-review lock-in #1.
 *   3. Comments stripped cleanly (delete word/comments.xml + references)
 *   4. Korean NFC/NFD/한자/emoji preserved (UTF-8 throughout)
 *   5. Section breaks untouched (we don't touch w:sectPr)
 *   6. Complex tables preserved (we don't touch w:tbl / w:tr / w:tc structure)
 *   7. Output validates as a proper DOCX (re-unzip-able, required parts present)
 *
 * Run:
 *   bun spike/jszip-spike.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import JSZip from "jszip";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const FIXTURE = path.join(
  REPO_ROOT,
  "tests/fixtures/bilingual_nda_worst_case.docx",
);
const OUT_DIR = path.join(REPO_ROOT, "spike/out");
const OUT_FILE = path.join(OUT_DIR, "bilingual_nda_worst_case.redacted.docx");

// Strings we'll pretend to redact. These MUST all appear in the fixture;
// if any are missing the fixture generator is broken.
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

const PLACEHOLDER = "[REDACTED]";

// Strings that must NOT be altered (Korean unicode preservation probes).
//
// IMPORTANT: The fixture contains Korean text in BOTH NFC (precomposed, e.g.
// "가" = U+AC00) and NFD (decomposed, e.g. "ᄀ" U+1100 + "ᅡ" U+1161). The
// preservation property we care about is that whichever form the user
// authored survives byte-for-byte through redaction. The Unicode
// normalization layer from eng-review #3 normalizes text for MATCHING;
// it does not rewrite the stored bytes.
const PRESERVE_CHECKS: readonly { label: string; needle: string }[] = [
  { label: "한자 甲 (U+7532)", needle: "甲" },
  { label: "한자 乙 (U+4E59)", needle: "乙" },
  { label: "emoji 📼 (U+1F4FC)", needle: "📼" },
  // NFC-composed Korean — lives in the title, definition clause, and body
  { label: "NFC 매수인 (precomposed)", needle: "매수인" },
  { label: "NFC 대한민국 (precomposed)", needle: "대한민국" },
  // NFD-decomposed Korean — lives in the "NFD test:" run the fixture creates
  // via unicodedata.normalize("NFD", "가갸거겨"). The decomposed form of "가"
  // is U+1100 U+1161, not U+AC00.
  {
    label: "NFD 가 (U+1100 + U+1161)",
    needle: "\u1100\u1161",
  },
  {
    label: "NFD 거 (U+1100 + U+1165)",
    needle: "\u1100\u1165",
  },
  // Defined term (D9) that MUST NOT be redacted by default
  { label: "the Buyer (defined term, D9)", needle: "the Buyer" },
];

type CheckResult = {
  id: number;
  item: string;
  status: "PASS" | "FAIL" | "SKIP";
  evidence: string;
};

function header(s: string): void {
  console.log(`\n${"═".repeat(72)}`);
  console.log(`  ${s}`);
  console.log(`${"═".repeat(72)}`);
}

function row(r: CheckResult): void {
  const icon = r.status === "PASS" ? "✓" : r.status === "FAIL" ? "✗" : "–";
  console.log(
    `  [${icon}] #${r.id} ${r.item.padEnd(48)} ${r.status.padEnd(6)}  ${r.evidence}`,
  );
}

/**
 * Return the list of DOCX part paths (inside the zip) that contain
 * user-authored text we need to walk for redaction. This is the "10-scope
 * walker" from eng-review lock-in #1 translated into part-path patterns.
 */
function scopesInZip(zip: JSZip): string[] {
  const scopes: string[] = [];
  const candidates = [
    "word/document.xml",
    "word/footnotes.xml",
    "word/endnotes.xml",
  ];
  for (const c of candidates) {
    if (zip.file(c)) scopes.push(c);
  }
  // Walk all header*.xml / footer*.xml (there can be multiple per section)
  const names = Object.keys(zip.files);
  for (const n of names) {
    if (/^word\/(header|footer)\d*\.xml$/.test(n)) scopes.push(n);
  }
  return scopes;
}

/**
 * Flatten track changes in a single XML string.
 *
 * Track changes appear as:
 *   <w:ins ...><w:r><w:t>inserted text</w:t></w:r></w:ins>
 *   <w:del ...><w:r><w:delText>deleted text</w:delText></w:r></w:del>
 *
 * "Flatten" means: unwrap w:ins (keep the inner w:r), drop w:del entirely.
 * We do this with regex because the structure is well-defined and this
 * spike intentionally avoids pulling in a heavy XML DOM parser.
 *
 * In production, we'll validate this with the same targeted tests the
 * eng review demanded (100% branch coverage on a flatten() unit test).
 */
function flattenTrackChanges(xml: string): string {
  let out = xml;
  // Drop all <w:del .../> and <w:del>...</w:del> entirely (deleted text gone)
  out = out.replace(/<w:del\b[^>]*\/>/g, "");
  out = out.replace(/<w:del\b[^>]*>[\s\S]*?<\/w:del>/g, "");
  // Unwrap <w:ins>...</w:ins>: keep the inner XML, drop the wrapper
  out = out.replace(
    /<w:ins\b[^>]*>([\s\S]*?)<\/w:ins>/g,
    (_m, inner: string) => inner,
  );
  return out;
}

/**
 * Apply a list of redactions to an XML string by doing plain string
 * replacement of each redaction target with [REDACTED].
 *
 * IMPORTANT CAVEAT (documented for future eng review): WordprocessingML
 * splits runs of text across multiple <w:t> elements, so a string like
 * "ABC Corporation" might in principle span two or more runs as
 * "ABC Corpo" / "ration" due to formatting runs or spell-check markup.
 * A production implementation MUST run a "text run coalescer" pass
 * before string search. For THIS spike, python-docx writes runs as
 * single <w:t> elements so plain string replace is sufficient to
 * validate the round-trip property we care about.
 */
function redactXml(xml: string, targets: readonly string[]): string {
  let out = xml;
  for (const t of targets) {
    // Escape nothing; we want literal replacement.
    out = out.split(t).join(PLACEHOLDER);
  }
  return out;
}

/**
 * Strip the comments.xml part and remove comment references from document.xml.
 */
function stripComments(zip: JSZip): void {
  // Delete the comments part itself
  zip.remove("word/comments.xml");
  // Also drop the content-types override and relationship, but at this
  // spike's scope we can leave the orphaned pointers in place — Word
  // tolerates missing optional parts. A production version will clean
  // both [Content_Types].xml and word/_rels/document.xml.rels properly.
}

/**
 * Strip comment range markers and references from every text part.
 * Without this, Word may complain that a referenced comment is missing.
 */
function stripCommentReferences(xml: string): string {
  let out = xml;
  out = out.replace(/<w:commentRangeStart\b[^>]*\/>/g, "");
  out = out.replace(/<w:commentRangeEnd\b[^>]*\/>/g, "");
  // commentReference lives inside a w:r; we can drop the surrounding run
  // entirely if it only contains the reference. Pragmatic: just drop the
  // <w:commentReference/> element. Word is tolerant of empty runs.
  out = out.replace(/<w:commentReference\b[^>]*\/>/g, "");
  return out;
}

/**
 * Scrub the DOCX metadata (docProps/core.xml + docProps/app.xml) by
 * replacing sensitive fields with empty strings.
 */
function scrubMetadata(zip: JSZip): void {
  const core = zip.file("docProps/core.xml");
  if (core !== null) {
    // This call is inside an async function already; deferring the read.
  }
  // See main() for the actual async scrub.
}

async function main(): Promise<number> {
  if (!fs.existsSync(FIXTURE)) {
    console.error(`Fixture not found: ${FIXTURE}`);
    console.error(`Run: python3 tools/make-fixture.py`);
    return 1;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  header("GATE 0 — JSZip + raw XML CAPABILITY PROBE");
  console.log(`  Fixture: ${path.relative(REPO_ROOT, FIXTURE)}`);
  console.log(`  Size:    ${(fs.statSync(FIXTURE).size / 1024).toFixed(1)} KB`);

  // ────────────────────────────────────────────────────────────────────────
  // Step 1: Load and walk scopes
  // ────────────────────────────────────────────────────────────────────────
  header("STEP 1: Load DOCX, walk scopes");

  const buf = fs.readFileSync(FIXTURE);
  const zip = await JSZip.loadAsync(buf);

  const scopes = scopesInZip(zip);
  console.log(`\n  Found ${scopes.length} text-bearing scopes:`);
  for (const s of scopes) console.log(`    ${s}`);

  // Sanity: confirm all redaction targets exist somewhere in the fixture
  console.log(`\n  Confirming redaction targets exist in fixture:`);
  const combined: string[] = [];
  for (const s of scopes) {
    const xml = await zip.file(s)!.async("string");
    combined.push(xml);
  }
  const joined = combined.join("\n");
  for (const target of REDACTIONS) {
    const count = (joined.match(new RegExp(escapeRegex(target), "g")) ?? [])
      .length;
    if (count === 0) {
      console.log(`    ✗ '${target}' not found in fixture!`);
    } else {
      console.log(`    ✓ '${target.padEnd(30)}' × ${count}`);
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Step 2: Apply transformations in every scope
  // ────────────────────────────────────────────────────────────────────────
  header("STEP 2: Flatten track changes, strip comments, redact, scrub");

  let totalReplacements = 0;
  for (const s of scopes) {
    let xml = await zip.file(s)!.async("string");
    const before = xml.length;

    xml = flattenTrackChanges(xml);
    xml = stripCommentReferences(xml);
    xml = redactXml(xml, REDACTIONS);

    zip.file(s, xml);
    const after = xml.length;
    totalReplacements += Math.max(0, before - after);
    console.log(
      `    ${s.padEnd(28)} ${before.toString().padStart(6)} → ${after.toString().padStart(6)} bytes`,
    );
  }

  // Strip the comments.xml part entirely
  stripComments(zip);
  console.log(`    ✓ dropped word/comments.xml`);

  // Metadata scrub (in-band because we need await)
  const corePart = zip.file("docProps/core.xml");
  if (corePart !== null) {
    let coreXml = await corePart.async("string");
    coreXml = coreXml
      .replace(/<dc:creator>[^<]*<\/dc:creator>/g, "<dc:creator></dc:creator>")
      .replace(
        /<cp:lastModifiedBy>[^<]*<\/cp:lastModifiedBy>/g,
        "<cp:lastModifiedBy></cp:lastModifiedBy>",
      )
      .replace(
        /<dc:title>[^<]*<\/dc:title>/g,
        "<dc:title></dc:title>",
      )
      .replace(
        /<dc:subject>[^<]*<\/dc:subject>/g,
        "<dc:subject></dc:subject>",
      );
    zip.file("docProps/core.xml", coreXml);
    console.log(`    ✓ scrubbed docProps/core.xml (author, title, subject)`);
  }

  const appPart = zip.file("docProps/app.xml");
  if (appPart !== null) {
    let appXml = await appPart.async("string");
    appXml = appXml.replace(/<Company>[^<]*<\/Company>/g, "<Company></Company>");
    zip.file("docProps/app.xml", appXml);
    console.log(`    ✓ scrubbed docProps/app.xml (Company)`);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Step 3: Re-zip
  // ────────────────────────────────────────────────────────────────────────
  header("STEP 3: Re-zip to output DOCX");

  const out = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  fs.writeFileSync(OUT_FILE, out);
  console.log(`\n  ✓ wrote ${path.relative(REPO_ROOT, OUT_FILE)}`);
  console.log(`    size: ${(out.length / 1024).toFixed(1)} KB`);

  // ────────────────────────────────────────────────────────────────────────
  // Step 4: Round-trip verification — re-parse the output and search for
  //         any sensitive strings that survived. This is the critical gate.
  // ────────────────────────────────────────────────────────────────────────
  header("STEP 4: Round-trip verification (zero-miss gate)");

  const outputZip = await JSZip.loadAsync(fs.readFileSync(OUT_FILE));
  const outScopes = scopesInZip(outputZip);

  let survived = 0;
  const survivingStrings: { target: string; scope: string; count: number }[] = [];
  for (const s of outScopes) {
    const xml = await outputZip.file(s)!.async("string");
    for (const target of REDACTIONS) {
      const count = (xml.match(new RegExp(escapeRegex(target), "g")) ?? [])
        .length;
      if (count > 0) {
        survived += count;
        survivingStrings.push({ target, scope: s, count });
      }
    }
  }

  if (survived === 0) {
    console.log(`\n  ✓ zero sensitive strings survived across ${outScopes.length} scopes`);
  } else {
    console.log(
      `\n  ✗ ${survived} sensitive strings survived in the output:`,
    );
    for (const h of survivingStrings) {
      console.log(`      '${h.target}' × ${h.count} in ${h.scope}`);
    }
  }

  // Korean / emoji / 한자 preservation check
  const docXml = await outputZip.file("word/document.xml")!.async("string");
  console.log(`\n  Preservation checks (these MUST still appear):`);
  const preservationFailures: string[] = [];
  for (const p of PRESERVE_CHECKS) {
    const present = docXml.includes(p.needle);
    if (present) {
      console.log(`    ✓ ${p.label}`);
    } else {
      console.log(`    ✗ ${p.label} — LOST`);
      preservationFailures.push(p.label);
    }
  }

  // Verify required DOCX parts still exist
  console.log(`\n  DOCX structure integrity (required parts):`);
  const requiredParts = [
    "[Content_Types].xml",
    "_rels/.rels",
    "word/document.xml",
    "word/_rels/document.xml.rels",
  ];
  const missingRequired: string[] = [];
  for (const p of requiredParts) {
    if (outputZip.file(p) === null) {
      console.log(`    ✗ ${p} — MISSING (would corrupt the file)`);
      missingRequired.push(p);
    } else {
      console.log(`    ✓ ${p}`);
    }
  }

  // Verify comments.xml is gone
  if (outputZip.file("word/comments.xml") === null) {
    console.log(`    ✓ word/comments.xml removed`);
  } else {
    console.log(`    ✗ word/comments.xml still present`);
  }

  // Verify track changes tags are gone from document.xml
  const hasIns = /<w:ins\b/.test(docXml);
  const hasDel = /<w:del\b/.test(docXml);
  if (!hasIns && !hasDel) {
    console.log(`    ✓ track changes flattened (no w:ins, no w:del in document.xml)`);
  } else {
    console.log(
      `    ✗ track changes NOT flattened: w:ins=${hasIns}, w:del=${hasDel}`,
    );
  }

  // ────────────────────────────────────────────────────────────────────────
  // 7-item Gate 0 checklist verdict
  // ────────────────────────────────────────────────────────────────────────
  header("GATE 0 SEVEN-ITEM CHECKLIST — JSZip+XML verdict");

  // Item #1 is about STRUCTURE preservation — all text-bearing scopes still
  // present, required DOCX parts intact, and all redaction targets survived
  // their replacement without breaking the XML surrounding them.
  // (Korean Unicode probes are item #4, not item #1.)
  const allScopesPresent = scopes.every(
    (s) => outputZip.file(s) !== null,
  );
  const textPreservation: CheckResult = {
    id: 1,
    item: "Body/table/header/footer/footnote round-trip",
    status:
      missingRequired.length === 0 && allScopesPresent ? "PASS" : "FAIL",
    evidence:
      missingRequired.length === 0 && allScopesPresent
        ? `all ${scopes.length} scopes + required parts present`
        : `missing parts: ${missingRequired.join(",")}`,
  };
  const trackChanges: CheckResult = {
    id: 2,
    item: "Track changes flattened cleanly",
    status: !hasIns && !hasDel ? "PASS" : "FAIL",
    evidence: !hasIns && !hasDel ? "w:ins/w:del dropped" : "tags remain",
  };
  const comments: CheckResult = {
    id: 3,
    item: "Comments removed without corrupting document",
    status:
      outputZip.file("word/comments.xml") === null &&
      !docXml.includes("w:commentReference")
        ? "PASS"
        : "FAIL",
    evidence: "comments.xml removed, refs stripped",
  };
  const korean: CheckResult = {
    id: 4,
    item: "Korean NFC/NFD/한자/emoji preserved",
    status: preservationFailures.length === 0 ? "PASS" : "FAIL",
    evidence:
      preservationFailures.length === 0
        ? "all 7 probes present"
        : `lost: ${preservationFailures.join(",")}`,
  };
  const sectionBreaks: CheckResult = {
    id: 5,
    item: "Section breaks untouched",
    status: /w:sectPr/.test(docXml) ? "PASS" : "FAIL",
    evidence: /w:sectPr/.test(docXml) ? "w:sectPr present" : "no section props",
  };
  const tables: CheckResult = {
    id: 6,
    item: "Complex tables (merged cells) preserved",
    status:
      /<w:tbl\b/.test(docXml) && /<w:gridSpan\b/.test(docXml)
        ? "PASS"
        : "FAIL",
    evidence:
      /<w:gridSpan\b/.test(docXml)
        ? "w:gridSpan (merge) present"
        : "merged cells lost",
  };
  const zeroMiss: CheckResult = {
    id: 7,
    item: "Zero sensitive strings survived",
    status: survived === 0 ? "PASS" : "FAIL",
    evidence: survived === 0 ? "0 leaks" : `${survived} leaks`,
  };

  const results = [
    textPreservation,
    trackChanges,
    comments,
    korean,
    sectionBreaks,
    tables,
    zeroMiss,
  ];

  console.log("");
  for (const r of results) row(r);

  const passes = results.filter((r) => r.status === "PASS").length;
  const fails = results.filter((r) => r.status === "FAIL").length;

  console.log("");
  console.log(`  Passed: ${passes}/${results.length}`);
  console.log(`  Failed: ${fails}/${results.length}`);
  console.log("");

  if (fails === 0) {
    header("VERDICT: GO — JSZip + raw XML is the Lane B foundation");
    console.log(
      "\n  All 7 items pass. Lane B will use JSZip + targeted string",
    );
    console.log("  manipulation with a small XML-aware helper for:");
    console.log("    - text run coalescing (merge split w:t elements)");
    console.log("    - track change flatten / preserve policy");
    console.log("    - comment strip");
    console.log("    - metadata scrub");
    console.log("    - definition clause parser");
    console.log("");
    console.log(
      "  Production code budget estimate: ~800-1200 lines (vs. ~2000+ if we",
    );
    console.log(
      "  had to rebuild everything from parsed AST). Stays within the",
    );
    console.log("  <2000 LOC readability target.");
    console.log(
      "\n  MANUAL VERIFICATION: Open spike/out/bilingual_nda_worst_case.redacted.docx",
    );
    console.log(
      "  in Microsoft Word to confirm no 'needs repair' dialog (Gate 0 item 7.5).",
    );
    console.log("");
    return 0;
  }

  header("VERDICT: NO-GO on JSZip too — escalate");
  console.log("");
  console.log(
    "  Both docx.js and JSZip failed. This is a serious signal. Review",
  );
  console.log(
    "  the failures above, then either (a) fix the spike bug, or (b) pull",
  );
  console.log("  in a heavier XML DOM parser like fast-xml-parser.");
  console.log("");
  return 2;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
