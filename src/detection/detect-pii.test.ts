import { describe, it, expect } from "vitest";
import JSZip from "jszip";

import {
  detectPii,
  detectPiiInZip,
  buildTargetsFromZip,
  type DetectedMatch,
} from "./detect-pii.js";

const W_NS = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"`;

function bodyWith(text: string): string {
  return `<w:document ${W_NS}><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`;
}

describe("detectPii", () => {
  it("returns an empty array for plain text", () => {
    expect(detectPii("Hello world, no PII here.")).toEqual([]);
  });

  it("detects an email", () => {
    const out = detectPii("Contact kim@abc-corp.kr for details.");
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("email");
    expect(out[0]!.original).toBe("kim@abc-corp.kr");
    expect(out[0]!.normalized).toBe("kim@abc-corp.kr");
  });

  it("detects a Korean mobile phone", () => {
    const out = detectPii("Cell: 010-1234-5678");
    expect(out.find((m) => m.kind === "phone-kr")?.original).toBe(
      "010-1234-5678",
    );
  });

  it("detects an international phone", () => {
    const out = detectPii("Call +1 415 555 0199 anytime.");
    expect(out.find((m) => m.kind === "phone-intl")?.original).toBe(
      "+1 415 555 0199",
    );
  });

  it("detects a 사업자등록번호", () => {
    const out = detectPii("Tax ID: 123-45-67890");
    expect(out.find((m) => m.kind === "brn")?.original).toBe("123-45-67890");
  });

  it("detects an EIN", () => {
    const out = detectPii("EIN 12-3456789 (US)");
    expect(out.find((m) => m.kind === "ein")?.original).toBe("12-3456789");
  });

  it("detects a 주민등록번호", () => {
    const out = detectPii("주민번호 900101-1234567");
    expect(out.find((m) => m.kind === "rrn")?.original).toBe("900101-1234567");
  });

  it("detects multiple distinct PII items in one paragraph", () => {
    const out = detectPii(
      "Contact kim@abc.kr at 010-1234-5678 (Tax 123-45-67890).",
    );
    const kinds = out.map((m) => m.kind).sort();
    expect(kinds).toContain("email");
    expect(kinds).toContain("phone-kr");
    expect(kinds).toContain("brn");
  });

  it("recovers the ORIGINAL substring when input has unicode hyphens", () => {
    // En-dashes in the phone number; the regex matches against normalized form
    // (ASCII hyphens) but `original` must come from the un-normalized text so
    // the redactor can find it in the XML verbatim.
    const orig = "Cell: 010\u20131234\u20135678";
    const out = detectPii(orig);
    const phone = out.find((m) => m.kind === "phone-kr");
    expect(phone).toBeDefined();
    expect(phone!.normalized).toBe("010-1234-5678");
    expect(phone!.original).toBe("010\u20131234\u20135678");
  });

  it("recovers the ORIGINAL substring when input has fullwidth digits", () => {
    // Fullwidth digits in phone; original is fullwidth, normalized is halfwidth.
    const orig = "Cell: \uFF10\uFF11\uFF10-\uFF11\uFF12\uFF13\uFF14-\uFF15\uFF16\uFF17\uFF18";
    const out = detectPii(orig);
    const phone = out.find((m) => m.kind === "phone-kr");
    expect(phone).toBeDefined();
    expect(phone!.normalized).toBe("010-1234-5678");
    expect(phone!.original).toBe(
      "\uFF10\uFF11\uFF10-\uFF11\uFF12\uFF13\uFF14-\uFF15\uFF16\uFF17\uFF18",
    );
  });

  it("recovers the ORIGINAL substring when input has zero-width chars", () => {
    const orig = "Cell: 010-12\u200B34-5678";
    const out = detectPii(orig);
    const phone = out.find((m) => m.kind === "phone-kr");
    expect(phone).toBeDefined();
    expect(phone!.original).toBe("010-12\u200B34-5678");
  });

  it("Luhn-validates credit card matches", () => {
    // Valid Visa test number (passes Luhn)
    const valid = detectPii("Card: 4111 1111 1111 1111");
    expect(valid.find((m) => m.kind === "card")).toBeDefined();
    // Same length, fails Luhn → must NOT be reported
    const invalid = detectPii("Card: 4111 1111 1111 1112");
    expect(invalid.find((m) => m.kind === "card")).toBeUndefined();
  });

  it("returns each occurrence separately for repeated emails", () => {
    const out = detectPii("kim@abc.kr ... kim@abc.kr ... kim@abc.kr");
    const emails = out.filter((m) => m.kind === "email");
    expect(emails).toHaveLength(3);
  });
});

describe("detectPiiInZip", () => {
  it("walks every scope and attaches the source scope to each match", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", bodyWith("Body: kim@abc.kr"));
    zip.file(
      "word/header1.xml",
      `<w:hdr ${W_NS}><w:p><w:r><w:t>Header: 010-1234-5678</w:t></w:r></w:p></w:hdr>`,
    );

    const out = await detectPiiInZip(zip);
    expect(out.length).toBeGreaterThanOrEqual(2);
    const email = out.find((m) => m.match.kind === "email");
    expect(email?.scope.kind).toBe("body");
    const phone = out.find((m) => m.match.kind === "phone-kr");
    expect(phone?.scope.kind).toBe("header");
  });
});

describe("buildTargetsFromZip", () => {
  it("returns a deduped, sorted list of original-form PII strings", async () => {
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      bodyWith(
        "Email kim@abc.kr ... again kim@abc.kr ... and 010-1234-5678",
      ),
    );

    const targets = await buildTargetsFromZip(zip);
    // Deduped: only one kim@abc.kr
    expect(targets.filter((t) => t === "kim@abc.kr")).toHaveLength(1);
    expect(targets).toContain("010-1234-5678");
  });

  it("dedupes across scopes", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", bodyWith("kim@abc.kr in body"));
    zip.file(
      "word/header1.xml",
      `<w:hdr ${W_NS}><w:p><w:r><w:t>kim@abc.kr in header</w:t></w:r></w:p></w:hdr>`,
    );

    const targets = await buildTargetsFromZip(zip);
    expect(targets.filter((t) => t === "kim@abc.kr")).toHaveLength(1);
  });

  it("returns the original (unicode) form when normalization fired", async () => {
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      bodyWith("Cell 010\u20131234\u20135678"), // en dashes
    );

    const targets = await buildTargetsFromZip(zip);
    // The redactor sees the XML, which has en-dashes, so the target string
    // must contain en-dashes too — NOT the ASCII-hyphen normalized form.
    expect(targets).toContain("010\u20131234\u20135678");
    expect(targets).not.toContain("010-1234-5678");
  });

  it("returns an empty array for a zip with no PII", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", bodyWith("just plain text here"));
    expect(await buildTargetsFromZip(zip)).toEqual([]);
  });
});

describe("DetectedMatch shape", () => {
  it("exposes kind, original, normalized as readonly fields", () => {
    const out: DetectedMatch[] = detectPii("kim@abc.kr");
    expect(out[0]).toMatchObject({
      kind: "email",
      original: "kim@abc.kr",
      normalized: "kim@abc.kr",
    });
  });
});
