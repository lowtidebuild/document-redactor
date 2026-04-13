/**
 * Lane A integration test against the real worst-case bilingual fixture.
 *
 * This is the end-to-end check that the PII detection sweep produces a
 * target list that, when fed into Lane B's `redactDocx`, results in a
 * clean verify pass — without any human-curated target list. In other
 * words: drop a DOCX in, get a redacted DOCX out, with PII gone.
 *
 * The fixture is the same one Lane B was validated against
 * (`tests/fixtures/bilingual_nda_worst_case.docx`). Lane A on its own
 * cannot produce a complete target list because company names and
 * person names need Lane C variant propagation. This test checks the
 * **PII slice** only: emails, phone numbers, BRN, EIN, etc. — the
 * categories the regex sweep is responsible for.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect, beforeAll } from "vitest";
import JSZip from "jszip";

import { buildResolvedTargetsFromStrings } from "../selection-targets.js";
import { buildTargetsFromZip, detectPiiInZip } from "./detect-pii.js";
import { redactDocx } from "../docx/redact-docx.js";
import { verifyRedaction } from "../docx/verify.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const FIXTURE = path.join(
  REPO_ROOT,
  "tests/fixtures/bilingual_nda_worst_case.docx",
);

/** Every PII string the fixture contains, by category. Curated for assertions. */
const FIXTURE_PII = {
  emails: ["kim@abc-corp.kr", "legal@sunrise.com"],
  phonesKr: ["010-1234-5678"],
  phonesIntl: ["+1 415 555 0199"],
  brn: ["123-45-67890"],
  ein: ["12-3456789"],
} as const;

describe("Lane A — detection sweep against the worst-case fixture", () => {
  let zip: JSZip;

  beforeAll(async () => {
    const buf = fs.readFileSync(FIXTURE);
    zip = await JSZip.loadAsync(buf);
  });

  it("loads the fixture (sanity check)", () => {
    expect(zip.file("word/document.xml")).not.toBeNull();
  });

  it("finds every fixture email", async () => {
    const matches = await detectPiiInZip(zip);
    const foundEmails = new Set(
      matches.filter((m) => m.match.kind === "email").map((m) => m.match.original),
    );
    for (const expected of FIXTURE_PII.emails) {
      expect(foundEmails).toContain(expected);
    }
  });

  it("finds the Korean mobile phone", async () => {
    const matches = await detectPiiInZip(zip);
    const phones = matches
      .filter((m) => m.match.kind === "phone-kr")
      .map((m) => m.match.original);
    for (const expected of FIXTURE_PII.phonesKr) {
      expect(phones).toContain(expected);
    }
  });

  it("finds the international phone", async () => {
    const matches = await detectPiiInZip(zip);
    const phones = matches
      .filter((m) => m.match.kind === "phone-intl")
      .map((m) => m.match.original);
    for (const expected of FIXTURE_PII.phonesIntl) {
      expect(phones).toContain(expected);
    }
  });

  it("finds the 사업자등록번호 (BRN)", async () => {
    const matches = await detectPiiInZip(zip);
    const brns = matches
      .filter((m) => m.match.kind === "brn")
      .map((m) => m.match.original);
    for (const expected of FIXTURE_PII.brn) {
      expect(brns).toContain(expected);
    }
  });

  it("finds the EIN", async () => {
    const matches = await detectPiiInZip(zip);
    const eins = matches
      .filter((m) => m.match.kind === "ein")
      .map((m) => m.match.original);
    for (const expected of FIXTURE_PII.ein) {
      expect(eins).toContain(expected);
    }
  });

  it("buildTargetsFromZip produces a deduped target list", async () => {
    const targets = await buildTargetsFromZip(zip);
    // Every expected PII string should appear in the target list
    const allExpected = [
      ...FIXTURE_PII.emails,
      ...FIXTURE_PII.phonesKr,
      ...FIXTURE_PII.phonesIntl,
      ...FIXTURE_PII.brn,
      ...FIXTURE_PII.ein,
    ];
    for (const expected of allExpected) {
      expect(targets).toContain(expected);
    }
    // No duplicates
    expect(targets.length).toBe(new Set(targets).size);
  });

  it("attributes the header email to the header scope, not the body", async () => {
    // The fixture's footer1 contains kim@abc-corp.kr (per the redact-docx
    // integration test). Lane A must surface that scope so the audit log
    // can show the lawyer where the leak vector lives.
    const matches = await detectPiiInZip(zip);
    const kimMatches = matches.filter(
      (m) => m.match.original === "kim@abc-corp.kr",
    );
    expect(kimMatches.length).toBeGreaterThan(0);
    const scopes = new Set(kimMatches.map((m) => m.scope.kind));
    // It should appear in the body and the footer (where the fixture seeds it)
    expect(scopes.has("footer")).toBe(true);
  });

  it("end-to-end: Lane A targets fed into Lane B produce a clean verify", async () => {
    // Reload the zip so the in-place mutation from redactDocx doesn't
    // pollute other tests in this file.
    const buf = fs.readFileSync(FIXTURE);
    const fresh = await JSZip.loadAsync(buf);
    const targets = await buildTargetsFromZip(fresh);
    const report = await redactDocx(fresh, { targets });
    expect(report.verify.isClean).toBe(true);
    // And verifying with the SAME target list against the output should
    // also be clean — defensive double-check.
    const v = await verifyRedaction(
      fresh,
      buildResolvedTargetsFromStrings(targets),
    );
    expect(v.isClean).toBe(true);
  });

  it("end-to-end: every PII string is gone from the output XML", async () => {
    const buf = fs.readFileSync(FIXTURE);
    const fresh = await JSZip.loadAsync(buf);
    const targets = await buildTargetsFromZip(fresh);
    await redactDocx(fresh, { targets });
    // Re-read every text-bearing scope and check that no PII string survived.
    const allExpected = [
      ...FIXTURE_PII.emails,
      ...FIXTURE_PII.phonesKr,
      ...FIXTURE_PII.phonesIntl,
      ...FIXTURE_PII.brn,
      ...FIXTURE_PII.ein,
    ];
    const v = await verifyRedaction(
      fresh,
      buildResolvedTargetsFromStrings(allExpected),
    );
    expect(v.isClean).toBe(true);
    expect(v.survived).toEqual([]);
  });
});
