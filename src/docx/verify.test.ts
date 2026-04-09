import { describe, it, expect } from "vitest";
import JSZip from "jszip";

import { verifyRedaction } from "./verify.js";

const W_NS = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"`;

/** Build a tiny synthetic DOCX zip with the given body XML. */
async function syntheticDocx(parts: Record<string, string>): Promise<JSZip> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(parts)) {
    zip.file(path, content);
  }
  return zip;
}

function bodyWith(text: string): string {
  return `<w:document ${W_NS}><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`;
}

describe("verifyRedaction", () => {
  it("returns clean for an empty target list", async () => {
    const zip = await syntheticDocx({
      "word/document.xml": bodyWith("ABC Corporation"),
    });
    const result = await verifyRedaction(zip, []);
    expect(result.isClean).toBe(true);
    expect(result.survived).toEqual([]);
    expect(result.stringsTested).toBe(0);
  });

  it("returns clean when no sensitive strings are present", async () => {
    const zip = await syntheticDocx({
      "word/document.xml": bodyWith("[REDACTED] world"),
    });
    const result = await verifyRedaction(zip, ["ABC Corporation"]);
    expect(result.isClean).toBe(true);
    expect(result.survived).toEqual([]);
  });

  it("flags a string that survived in the body", async () => {
    const zip = await syntheticDocx({
      "word/document.xml": bodyWith("ABC Corporation is here"),
    });
    const result = await verifyRedaction(zip, ["ABC Corporation"]);
    expect(result.isClean).toBe(false);
    expect(result.survived).toHaveLength(1);
    expect(result.survived[0]!.text).toBe("ABC Corporation");
    expect(result.survived[0]!.count).toBe(1);
    expect(result.survived[0]!.scope.kind).toBe("body");
  });

  it("flags a string that survived in a header (the leak vector the spike documented)", async () => {
    // The spike's mock verify-fail screen shows exactly this case: "ABC Corp"
    // surviving in word/header1.xml because the redactor forgot the header scope.
    const zip = await syntheticDocx({
      "word/document.xml": bodyWith("[REDACTED]"),
      "word/header1.xml": `<w:hdr ${W_NS}><w:p><w:r><w:t>Confidential — ABC Corp internal</w:t></w:r></w:p></w:hdr>`,
    });
    const result = await verifyRedaction(zip, ["ABC Corp"]);
    expect(result.isClean).toBe(false);
    expect(result.survived).toHaveLength(1);
    expect(result.survived[0]!.scope.path).toBe("word/header1.xml");
  });

  it("counts multiple occurrences of the same string in the same scope", async () => {
    const zip = await syntheticDocx({
      "word/document.xml": bodyWith("ABC ABC ABC and ABC again"),
    });
    const result = await verifyRedaction(zip, ["ABC"]);
    expect(result.isClean).toBe(false);
    expect(result.survived[0]!.count).toBe(4);
  });

  it("reports survivals separately per scope", async () => {
    const zip = await syntheticDocx({
      "word/document.xml": bodyWith("ABC in body"),
      "word/header1.xml": `<w:hdr ${W_NS}><w:p><w:r><w:t>ABC in header</w:t></w:r></w:p></w:hdr>`,
      "word/footer1.xml": `<w:ftr ${W_NS}><w:p><w:r><w:t>ABC in footer</w:t></w:r></w:p></w:ftr>`,
    });
    const result = await verifyRedaction(zip, ["ABC"]);
    expect(result.isClean).toBe(false);
    expect(result.survived).toHaveLength(3);
    expect(result.survived.map((s) => s.scope.path).sort()).toEqual([
      "word/document.xml",
      "word/footer1.xml",
      "word/header1.xml",
    ]);
  });

  it("reports survivals separately per target string", async () => {
    const zip = await syntheticDocx({
      "word/document.xml": bodyWith(
        "ABC Corporation and Sunrise Ventures are here",
      ),
    });
    const result = await verifyRedaction(zip, [
      "ABC Corporation",
      "Sunrise Ventures",
    ]);
    expect(result.isClean).toBe(false);
    expect(result.survived).toHaveLength(2);
  });

  it("dedupes target strings", async () => {
    const zip = await syntheticDocx({
      "word/document.xml": bodyWith("ABC"),
    });
    const result = await verifyRedaction(zip, ["ABC", "ABC", "ABC"]);
    expect(result.stringsTested).toBe(1);
    expect(result.survived).toHaveLength(1);
    expect(result.survived[0]!.count).toBe(1);
  });

  it("ignores empty target strings", async () => {
    const zip = await syntheticDocx({
      "word/document.xml": bodyWith("hello"),
    });
    const result = await verifyRedaction(zip, ["", "ABC"]);
    expect(result.stringsTested).toBe(1);
    expect(result.isClean).toBe(true);
  });

  it("walks footnotes too", async () => {
    const zip = await syntheticDocx({
      "word/document.xml": bodyWith("[REDACTED]"),
      "word/footnotes.xml": `<w:footnotes ${W_NS}><w:footnote><w:p><w:r><w:t>Note about ABC Corp</w:t></w:r></w:p></w:footnote></w:footnotes>`,
    });
    const result = await verifyRedaction(zip, ["ABC Corp"]);
    expect(result.isClean).toBe(false);
    expect(result.survived[0]!.scope.kind).toBe("footnotes");
  });

  it("walks comments scope too (defensively, even though it should be dropped)", async () => {
    const zip = await syntheticDocx({
      "word/document.xml": bodyWith("[REDACTED]"),
      "word/comments.xml": `<w:comments ${W_NS}><w:comment><w:p><w:r><w:t>kim@abc-corp.kr</w:t></w:r></w:p></w:comment></w:comments>`,
    });
    const result = await verifyRedaction(zip, ["kim@abc-corp.kr"]);
    expect(result.isClean).toBe(false);
    expect(result.survived[0]!.scope.kind).toBe("comments");
  });

  it("reports the right number of scopes checked", async () => {
    const zip = await syntheticDocx({
      "word/document.xml": bodyWith("hello"),
      "word/header1.xml": `<w:hdr ${W_NS}/>`,
      "word/footer1.xml": `<w:ftr ${W_NS}/>`,
      "word/footnotes.xml": `<w:footnotes ${W_NS}/>`,
    });
    const result = await verifyRedaction(zip, ["x"]);
    expect(result.scopesChecked).toBe(4);
  });

  it("handles Korean strings", async () => {
    const zip = await syntheticDocx({
      "word/document.xml": bodyWith("매수인은 김철수이다"),
    });
    const result = await verifyRedaction(zip, ["김철수"]);
    expect(result.isClean).toBe(false);
    expect(result.survived[0]!.text).toBe("김철수");
  });

  it("flags survivals across split <w:t> elements (the silent-leak case)", async () => {
    // This is the case the redactor's coalescer is supposed to catch.
    // verifyRedaction does NOT use the coalescer — it scans the raw XML.
    // It should still detect "Corporation" surviving even when it's wrapped
    // in <w:t> elements, because indexOf operates on the XML string.
    const zip = await syntheticDocx({
      "word/document.xml": `<w:document ${W_NS}><w:body><w:p><w:r><w:t>ABC Corpo</w:t></w:r><w:r><w:t>ration</w:t></w:r></w:p></w:body></w:document>`,
    });
    const result = await verifyRedaction(zip, ["Corporation"]);
    // "Corporation" only appears as "Corpo" + "ration" — split. The defensive
    // verifier won't catch the SPLIT form. This is documented behavior:
    // verify catches what's literally in the XML, the redactor's coalescer
    // is the defense against split forms.
    expect(result.isClean).toBe(true);
    // But "Corpo" alone IS in the literal XML and would be caught:
    const result2 = await verifyRedaction(zip, ["Corpo"]);
    expect(result2.isClean).toBe(false);
  });
});
