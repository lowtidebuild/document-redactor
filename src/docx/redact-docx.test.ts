/**
 * Integration test for the DOCX redaction orchestrator.
 *
 * Loads the worst-case bilingual NDA fixture (the same one Gate 0 used),
 * runs the full redaction pipeline, and asserts the seven Gate 0 invariants
 * one more time — but now against the production code, not the spike code.
 *
 * This test is deliberately bigger than a unit test: it walks every layer
 * (load → flatten → strip → redact → drop → scrub → verify) using only the
 * public API. If any module regresses, this test catches the regression
 * before it ships.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect, beforeAll } from "vitest";
import JSZip from "jszip";

import { redactDocx } from "./redact-docx.js";
import { listScopes, readScopeXml } from "./scopes.js";
import { hasTrackChanges } from "./flatten-track-changes.js";
import { hasCommentReferences } from "./strip-comments.js";
import { verifyRedaction } from "./verify.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const FIXTURE = path.join(
  REPO_ROOT,
  "tests/fixtures/bilingual_nda_worst_case.docx",
);

// Same redaction list the spike used. The orchestrator should produce the
// same end state.
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

// Strings that MUST survive — D9 defined-term policy + Korean Unicode probes.
const MUST_SURVIVE: readonly string[] = [
  "the Buyer",
  "매수인",
  "甲",
  "乙",
  "📼",
  "대한민국",
] as const;

describe("redactDocx — integration against the worst-case bilingual fixture", () => {
  let outZip: JSZip;
  let report: Awaited<ReturnType<typeof redactDocx>>;

  beforeAll(async () => {
    const buf = fs.readFileSync(FIXTURE);
    outZip = await JSZip.loadAsync(buf);
    report = await redactDocx(outZip, { targets: REDACTIONS });
  });

  it("returns a clean verify result (zero-miss ship gate)", () => {
    expect(report.verify.isClean).toBe(true);
    expect(report.verify.survived).toHaveLength(0);
  });

  it("walked at least 5 text-bearing scopes (body, 2 headers, 2 footers)", () => {
    expect(report.scopeMutations.length).toBeGreaterThanOrEqual(5);
  });

  it("flattens all track changes from word/document.xml", async () => {
    const docXml = await readScopeXml(outZip, {
      kind: "body",
      path: "word/document.xml",
    });
    expect(hasTrackChanges(docXml)).toBe(false);
  });

  it("removes the comments part entirely", () => {
    expect(outZip.file("word/comments.xml")).toBeNull();
  });

  it("strips comment references from every text scope", async () => {
    const scopes = listScopes(outZip).filter((s) => s.kind !== "comments");
    for (const scope of scopes) {
      const xml = await readScopeXml(outZip, scope);
      expect(hasCommentReferences(xml)).toBe(false);
    }
  });

  it("scrubs docProps/core.xml metadata to empty values", async () => {
    const core = outZip.file("docProps/core.xml");
    expect(core).not.toBeNull();
    const xml = await core!.async("string");
    // Each scrubbed field must EITHER be empty (`<X></X>`) OR self-closing
    // (`<X/>`). Both forms carry zero data, which is what matters.
    function fieldIsEmpty(localName: string): boolean {
      const empty = new RegExp(
        `<(?:[a-z]+:)?${localName}[^>]*\\/>|<(?:[a-z]+:)?${localName}[^>]*></[^>]*${localName}>`,
      );
      return empty.test(xml);
    }
    for (const f of [
      "creator",
      "lastModifiedBy",
      "title",
      "subject",
      "description",
      "keywords",
    ]) {
      expect(fieldIsEmpty(f)).toBe(true);
    }
  });

  it("preserves all D9 defined-term and Korean Unicode probes (D4 + D9)", async () => {
    const docXml = await readScopeXml(outZip, {
      kind: "body",
      path: "word/document.xml",
    });
    for (const survivor of MUST_SURVIVE) {
      expect(docXml).toContain(survivor);
    }
  });

  it("preserves section properties (w:sectPr)", async () => {
    const docXml = await readScopeXml(outZip, {
      kind: "body",
      path: "word/document.xml",
    });
    expect(docXml).toContain("w:sectPr");
  });

  it("preserves merged-cell tables (w:gridSpan)", async () => {
    const docXml = await readScopeXml(outZip, {
      kind: "body",
      path: "word/document.xml",
    });
    expect(docXml).toContain("<w:tbl");
    expect(docXml).toContain("<w:gridSpan");
  });

  it("redacts in headers (the spike's hardest leak vector)", async () => {
    const header1 = outZip.file("word/header1.xml");
    expect(header1).not.toBeNull();
    const xml = await header1!.async("string");
    // The header originally said: "CONFIDENTIAL — ABC Corporation internal · Draft v3"
    // After redaction it should contain [REDACTED] in place of ABC Corporation.
    expect(xml).toContain("[REDACTED]");
    expect(xml).not.toContain("ABC Corporation");
  });

  it("redacts in footers", async () => {
    const footer1 = outZip.file("word/footer1.xml");
    expect(footer1).not.toBeNull();
    const xml = await footer1!.async("string");
    expect(xml).toContain("[REDACTED]");
    expect(xml).not.toContain("kim@abc-corp.kr");
  });

  it("preserves 'the Buyer' in paragraph 3.1 (D9 in action)", async () => {
    const docXml = await readScopeXml(outZip, {
      kind: "body",
      path: "word/document.xml",
    });
    // 3.1 reads: "The Buyer acknowledges that ABC Corporation may disclose..."
    // After redaction: "The Buyer acknowledges that [REDACTED] may disclose..."
    // The defined term "Buyer" must survive. This is the bug the user
    // initially worried about — verified end-to-end here.
    expect(docXml).toContain("Buyer");
    expect(docXml).not.toContain("The [REDACTED] acknowledges");
  });

  it("the resulting zip can be re-loaded by JSZip (round-trip integrity)", async () => {
    const out = await outZip.generateAsync({ type: "nodebuffer" });
    const reloaded = await JSZip.loadAsync(out);
    expect(reloaded.file("word/document.xml")).not.toBeNull();
    expect(reloaded.file("[Content_Types].xml")).not.toBeNull();
  });

  it("does NOT flag a clean result when the input has nothing sensitive", async () => {
    const buf = fs.readFileSync(FIXTURE);
    const cleanZip = await JSZip.loadAsync(buf);
    const cleanReport = await redactDocx(cleanZip, {
      targets: ["__nonsense_string_that_will_not_appear__"],
    });
    expect(cleanReport.verify.isClean).toBe(true);
  });

  it("flags a leak when verify finds an un-redacted string", async () => {
    // Build a target list that omits "ABC Corporation" — the verifier should
    // catch the survival on its own (because we tell it to look for "ABC
    // Corporation" but redactDocx never replaced it).
    const buf = fs.readFileSync(FIXTURE);
    const partialZip = await JSZip.loadAsync(buf);
    // Pass a NARROWER target list to redactDocx (so the redactor doesn't
    // redact ABC Corporation), then run the verifier separately with the
    // FULL list to confirm it catches the leak.
    await redactDocx(partialZip, { targets: ["[__never__]"] });
    // Now run a verify with the real list — should find ABC Corporation
    // surviving.
    const v = await verifyRedaction(partialZip, ["ABC Corporation"]);
    expect(v.isClean).toBe(false);
    expect(v.survived[0]!.text).toBe("ABC Corporation");
  });
});
