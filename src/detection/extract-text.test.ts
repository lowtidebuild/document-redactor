import { describe, it, expect } from "vitest";
import JSZip from "jszip";

import { extractScopeText, extractTextFromZip } from "./extract-text.js";

const W_NS = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"`;

function bodyWithParagraphs(...paragraphs: string[]): string {
  const ps = paragraphs
    .map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`)
    .join("");
  return `<w:document ${W_NS}><w:body>${ps}</w:body></w:document>`;
}

describe("extractScopeText", () => {
  it("returns empty string for an empty body", () => {
    expect(extractScopeText(`<w:document ${W_NS}><w:body/></w:document>`)).toBe(
      "",
    );
  });

  it("extracts a single paragraph", () => {
    expect(extractScopeText(bodyWithParagraphs("Hello world"))).toBe(
      "Hello world",
    );
  });

  it("joins multiple paragraphs with newlines", () => {
    expect(
      extractScopeText(bodyWithParagraphs("first", "second", "third")),
    ).toBe("first\nsecond\nthird");
  });

  it("decodes XML entities inside text runs", () => {
    const xml = `<w:document ${W_NS}><w:body><w:p><w:r><w:t>A &amp; B</w:t></w:r></w:p></w:body></w:document>`;
    expect(extractScopeText(xml)).toBe("A & B");
  });

  it("merges runs split across formatting boundaries", () => {
    // "ABC Corporation" stored as two runs (the silent-leak case)
    const xml = `<w:document ${W_NS}><w:body><w:p><w:r><w:t>ABC Corpo</w:t></w:r><w:r><w:t>ration</w:t></w:r></w:p></w:body></w:document>`;
    expect(extractScopeText(xml)).toBe("ABC Corporation");
  });

  it("ignores <w:pPr> blocks (must not match the paragraph regex)", () => {
    const xml = `<w:document ${W_NS}><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Heading</w:t></w:r></w:p></w:body></w:document>`;
    expect(extractScopeText(xml)).toBe("Heading");
  });

  it("walks paragraphs inside table cells", () => {
    // Tables: <w:tbl><w:tr><w:tc><w:p>...</w:p></w:tc></w:tr></w:tbl>
    const xml = `<w:document ${W_NS}><w:body><w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>cell B</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`;
    expect(extractScopeText(xml)).toBe("cell A\ncell B");
  });

  it("handles a paragraph with no runs (empty paragraph)", () => {
    const xml = `<w:document ${W_NS}><w:body><w:p/></w:body></w:document>`;
    expect(extractScopeText(xml)).toBe("");
  });

  it("preserves Korean characters", () => {
    expect(extractScopeText(bodyWithParagraphs("매수인은 갑이다"))).toBe(
      "매수인은 갑이다",
    );
  });
});

describe("extractTextFromZip", () => {
  it("walks every text-bearing scope and returns one entry per scope", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", bodyWithParagraphs("body text"));
    zip.file(
      "word/header1.xml",
      `<w:hdr ${W_NS}><w:p><w:r><w:t>header text</w:t></w:r></w:p></w:hdr>`,
    );
    zip.file(
      "word/footer1.xml",
      `<w:ftr ${W_NS}><w:p><w:r><w:t>footer text</w:t></w:r></w:p></w:ftr>`,
    );

    const out = await extractTextFromZip(zip);
    expect(out).toHaveLength(3);
    expect(out.find((e) => e.scope.kind === "body")?.text).toBe("body text");
    expect(out.find((e) => e.scope.kind === "header")?.text).toBe(
      "header text",
    );
    expect(out.find((e) => e.scope.kind === "footer")?.text).toBe(
      "footer text",
    );
  });

  it("walks footnotes too", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", bodyWithParagraphs("main"));
    zip.file(
      "word/footnotes.xml",
      `<w:footnotes ${W_NS}><w:footnote><w:p><w:r><w:t>fn body</w:t></w:r></w:p></w:footnote></w:footnotes>`,
    );

    const out = await extractTextFromZip(zip);
    expect(out.find((e) => e.scope.kind === "footnotes")?.text).toBe("fn body");
  });

  it("returns scopes in walker order (body → footnotes → ... → headers → footers)", async () => {
    const zip = new JSZip();
    zip.file(
      "word/footer1.xml",
      `<w:ftr ${W_NS}><w:p><w:r><w:t>f</w:t></w:r></w:p></w:ftr>`,
    );
    zip.file(
      "word/header1.xml",
      `<w:hdr ${W_NS}><w:p><w:r><w:t>h</w:t></w:r></w:p></w:hdr>`,
    );
    zip.file("word/document.xml", bodyWithParagraphs("b"));
    zip.file(
      "word/comments.xml",
      `<w:comments ${W_NS}><w:comment><w:p><w:r><w:t>c</w:t></w:r></w:p></w:comment></w:comments>`,
    );

    const out = await extractTextFromZip(zip);
    expect(out.map((e) => e.scope.kind)).toEqual([
      "body",
      "comments",
      "header",
      "footer",
    ]);
  });
});
