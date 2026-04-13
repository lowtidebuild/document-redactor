import { describe, expect, it } from "vitest";
import JSZip from "jszip";

import { flattenFields, flattenFieldsInZip } from "./flatten-fields.js";

const W_NS = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;

function body(inner: string): string {
  return `<w:document ${W_NS}><w:body>${inner}</w:body></w:document>`;
}

function paragraph(inner: string): string {
  return `<w:p>${inner}</w:p>`;
}

function run(text: string): string {
  return `<w:r><w:t>${text}</w:t></w:r>`;
}

function runWithInstr(text: string): string {
  return `<w:r><w:instrText xml:space="preserve">${text}</w:instrText></w:r>`;
}

function fldCharRun(kind: "begin" | "separate" | "end"): string {
  return `<w:r><w:fldChar w:fldCharType="${kind}"/></w:r>`;
}

function hasFieldMarkup(xml: string): boolean {
  return (
    xml.includes("<w:fldChar") ||
    xml.includes("<w:instrText") ||
    xml.includes("<w:fldSimple") ||
    xml.includes("<w:hyperlink")
  );
}

describe("flattenFields", () => {
  it("is a no-op on XML with no fields or hyperlinks", () => {
    const xml = body(paragraph(run("plain text")));
    expect(flattenFields(xml)).toBe(xml);
  });

  it("unwraps a simple field and preserves the inner display run", () => {
    const xml = body(
      paragraph(
        `${run("이메일: ")}<w:fldSimple w:instr=" HYPERLINK &quot;mailto:contact@pearlabyss.com&quot; ">${run("contact@pearlabyss.com")}</w:fldSimple>`,
      ),
    );

    const out = flattenFields(xml);

    expect(out).toContain("contact@pearlabyss.com");
    expect(out).not.toContain("<w:fldSimple");
    expect(out).not.toContain("mailto:contact@pearlabyss.com");
  });

  it("drops the simple-field wrapper even when there are multiple inner runs", () => {
    const xml = body(
      paragraph(
        `<w:fldSimple w:instr=" HYPERLINK &quot;mailto:foo@bar.com&quot; ">${run("foo@")}${run("bar.com")}</w:fldSimple>`,
      ),
    );

    const out = flattenFields(xml);

    expect(out).toContain(`${run("foo@")}${run("bar.com")}`);
    expect(out).not.toContain("<w:fldSimple");
  });

  it("removes a self-closing simple field entirely", () => {
    const xml = body(paragraph(`<w:fldSimple w:instr=" AUTHOR "/>${run("tail")}`));
    expect(flattenFields(xml)).toBe(body(paragraph(run("tail"))));
  });

  it("preserves surrounding non-field runs around a simple field", () => {
    const xml = body(
      paragraph(
        `${run("before ")}<w:fldSimple w:instr=" HYPERLINK &quot;mailto:a@b.com&quot; ">${run("a@b.com")}</w:fldSimple>${run(" after")}`,
      ),
    );
    const out = flattenFields(xml);
    expect(out).toContain("before ");
    expect(out).toContain(" after");
    expect(out).toContain("a@b.com");
  });

  it("drops complex-field marker runs", () => {
    const xml = body(
      paragraph(
        `${fldCharRun("begin")}${fldCharRun("separate")}${fldCharRun("end")}`,
      ),
    );
    const out = flattenFields(xml);
    expect(out).not.toContain("<w:fldChar");
    expect(out).toBe(body(paragraph("")));
  });

  it("drops the complex-field instrText run entirely", () => {
    const xml = body(
      paragraph(
        `${fldCharRun("begin")}${runWithInstr(' HYPERLINK "mailto:contact@pearlabyss.com" ')}${fldCharRun("separate")}${run("contact@pearlabyss.com")}${fldCharRun("end")}`,
      ),
    );
    const out = flattenFields(xml);
    expect(out).not.toContain("<w:instrText");
    expect(out).not.toContain('mailto:contact@pearlabyss.com');
    expect(out).toContain("contact@pearlabyss.com");
  });

  it("preserves the display portion of a complex field", () => {
    const xml = body(
      paragraph(
        `${run("담당자: ")}${fldCharRun("begin")}${runWithInstr(' HYPERLINK "mailto:contact@pearlabyss.com" ')}${fldCharRun("separate")}${run("contact@pearlabyss.com")}${fldCharRun("end")}`,
      ),
    );
    const out = flattenFields(xml);
    expect(out).toContain("담당자: ");
    expect(out).toContain("contact@pearlabyss.com");
    expect(hasFieldMarkup(out)).toBe(false);
  });

  it("preserves multi-run display text inside a complex field", () => {
    const xml = body(
      paragraph(
        `${fldCharRun("begin")}${runWithInstr(' HYPERLINK "mailto:foo@bar.com" ')}${fldCharRun("separate")}${run("foo@")}${run("bar.com")}${fldCharRun("end")}`,
      ),
    );
    const out = flattenFields(xml);
    expect(out).toContain(`${run("foo@")}${run("bar.com")}`);
    expect(hasFieldMarkup(out)).toBe(false);
  });

  it("handles a complex field whose display continues in the next paragraph", () => {
    const xml = body(
      `${paragraph(`${fldCharRun("begin")}${runWithInstr(' HYPERLINK "mailto:foo@bar.com" ')}${fldCharRun("separate")}`)}${paragraph(`${run("foo@bar.com")}${fldCharRun("end")}`)}`,
    );
    const out = flattenFields(xml);
    expect(out).toContain(run("foo@bar.com"));
    expect(hasFieldMarkup(out)).toBe(false);
  });

  it("unwraps a hyperlink and keeps the inner run", () => {
    const xml = body(
      paragraph(
        `${run("문의: ")}<w:hyperlink r:id="rId5" w:history="1">${run("contact@pearlabyss.com")}</w:hyperlink>`,
      ),
    );
    const out = flattenFields(xml);
    expect(out).toContain("contact@pearlabyss.com");
    expect(out).not.toContain("<w:hyperlink");
    expect(out).not.toContain('r:id="rId5"');
  });

  it("unwraps multiple consecutive hyperlinks without over-matching", () => {
    const xml = body(
      paragraph(
        `<w:hyperlink r:id="rId1">${run("first@example.com")}</w:hyperlink><w:hyperlink r:id="rId2">${run("second@example.com")}</w:hyperlink>`,
      ),
    );
    const out = flattenFields(xml);
    expect(out).toContain("first@example.com");
    expect(out).toContain("second@example.com");
    expect(out).not.toContain("<w:hyperlink");
  });

  it("removes a self-closing hyperlink entirely", () => {
    const xml = body(paragraph(`<w:hyperlink r:id="rId5"/>${run("tail")}`));
    expect(flattenFields(xml)).toBe(body(paragraph(run("tail"))));
  });

  it("flattens mixed simple, complex, and hyperlink markup in one paragraph", () => {
    const xml = body(
      paragraph(
        `${run("a ")}<w:fldSimple w:instr=" AUTHOR ">${run("simple")}</w:fldSimple>${run(" b ")}${fldCharRun("begin")}${runWithInstr(" AUTHOR ")}${fldCharRun("separate")}${run("complex")}${fldCharRun("end")}${run(" c ")}<w:hyperlink r:id="rId9">${run("hyper")}</w:hyperlink>`,
      ),
    );
    const out = flattenFields(xml);
    expect(out).toContain("simple");
    expect(out).toContain("complex");
    expect(out).toContain("hyper");
    expect(hasFieldMarkup(out)).toBe(false);
  });

  it("handles adjacent field constructs without swallowing surrounding runs", () => {
    const xml = body(
      paragraph(
        `<w:fldSimple w:instr=" AUTHOR ">${run("one")}</w:fldSimple><w:hyperlink r:id="rId2">${run("two")}</w:hyperlink>${fldCharRun("begin")}${runWithInstr(" AUTHOR ")}${fldCharRun("separate")}${run("three")}${fldCharRun("end")}`,
      ),
    );
    const out = flattenFields(xml);
    expect(out).toContain("one");
    expect(out).toContain("two");
    expect(out).toContain("three");
    expect(hasFieldMarkup(out)).toBe(false);
  });

  it("is idempotent — second application is a no-op", () => {
    const raw = body(
      paragraph(
        `${fldCharRun("begin")}${runWithInstr(' HYPERLINK "mailto:foo@bar.com" ')}${fldCharRun("separate")}${run("foo@bar.com")}${fldCharRun("end")}<w:hyperlink r:id="rId5">${run("linked")}</w:hyperlink>`,
      ),
    );
    const once = flattenFields(raw);
    const twice = flattenFields(once);
    expect(twice).toBe(once);
  });
});

describe("flattenFieldsInZip", () => {
  it("applies flattening to every text-bearing scope in the zip", async () => {
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      body(paragraph(`<w:hyperlink r:id="rId1">${run("body@example.com")}</w:hyperlink>`)),
    );
    zip.file(
      "word/header1.xml",
      `<w:hdr ${W_NS}>${paragraph(`<w:fldSimple w:instr=" HYPERLINK &quot;mailto:head@example.com&quot; ">${run("head@example.com")}</w:fldSimple>`)}</w:hdr>`,
    );
    zip.file(
      "word/footer1.xml",
      `<w:ftr ${W_NS}>${paragraph(`${fldCharRun("begin")}${runWithInstr(' HYPERLINK "mailto:foot@example.com" ')}${fldCharRun("separate")}${run("foot@example.com")}${fldCharRun("end")}`)}</w:ftr>`,
    );

    await flattenFieldsInZip(zip);

    expect(await zip.file("word/document.xml")!.async("string")).not.toContain("<w:hyperlink");
    expect(await zip.file("word/header1.xml")!.async("string")).not.toContain("<w:fldSimple");
    expect(await zip.file("word/footer1.xml")!.async("string")).not.toContain("<w:instrText");
  });

  it("is idempotent at the zip level too", async () => {
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      body(paragraph(`${fldCharRun("begin")}${runWithInstr(" AUTHOR ")}${fldCharRun("separate")}${run("display")}${fldCharRun("end")}`)),
    );

    await flattenFieldsInZip(zip);
    const once = await zip.file("word/document.xml")!.async("string");
    await flattenFieldsInZip(zip);
    const twice = await zip.file("word/document.xml")!.async("string");

    expect(twice).toBe(once);
  });
});
