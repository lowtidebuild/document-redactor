import { readFileSync } from "node:fs";

import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { extractTextFromZip } from "../detection/extract-text.js";
import { renderDocumentBody } from "./render-body.js";
import { collectScopeArtifacts } from "./scope-artifacts.js";
import { collectVerifySurfaces } from "./verify-surfaces.js";

const W_NS = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"`;

function bodyWithXml(inner: string): string {
  return `<w:document ${W_NS}><w:body>${inner}</w:body></w:document>`;
}

function paragraph(text: string): string {
  return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

async function loadFixtureZip(): Promise<JSZip> {
  const bytes = readFileSync("tests/fixtures/bilingual_nda_worst_case.docx");
  return await JSZip.loadAsync(bytes);
}

describe("collectScopeArtifacts", () => {
  it("matches the legacy text, render, and verifier surface outputs on the fixture", async () => {
    const zip = await loadFixtureZip();

    const legacyText = await extractTextFromZip(zip);
    const legacyRendered = await renderDocumentBody(zip);
    const legacyVerifySurfaces = await collectVerifySurfaces(zip);
    const artifacts = await collectScopeArtifacts(zip);

    expect(artifacts.scopedText).toEqual(legacyText);
    expect(artifacts.renderedDoc).toEqual(legacyRendered);
    expect(artifacts.verifySurfaces).toEqual(legacyVerifySurfaces);
  });

  it("preserves empty paragraphs, instr surfaces, rel targets, and scope order", async () => {
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      bodyWithXml(
        `<w:p/>${paragraph("body text")}<w:p><w:fldSimple w:instr="HYPERLINK &quot;mailto:field@example.invalid&quot;"><w:r><w:t>field</w:t></w:r></w:fldSimple></w:p>`,
      ),
    );
    zip.file(
      "word/comments.xml",
      `<w:comments ${W_NS}>${paragraph("comment text")}</w:comments>`,
    );
    zip.file(
      "word/header2.xml",
      `<w:hdr ${W_NS}>${paragraph("header text")}</w:hdr>`,
    );
    zip.file(
      "word/footer1.xml",
      `<w:ftr ${W_NS}><w:p><w:r><w:instrText xml:space="preserve">HYPERLINK "mailto:instr@example.invalid"</w:instrText></w:r></w:p></w:ftr>`,
    );
    zip.file(
      "word/_rels/document.xml.rels",
      `<Relationships><Relationship Id="rId1" Target="mailto:rel@example.invalid"/></Relationships>`,
    );

    const artifacts = await collectScopeArtifacts(zip);

    expect(artifacts.scopes.map((scope) => scope.path)).toEqual([
      "word/document.xml",
      "word/comments.xml",
      "word/header2.xml",
      "word/footer1.xml",
    ]);
    expect(
      artifacts.renderedDoc.scopes[0]?.paragraphs.map(
        (renderedParagraph) => renderedParagraph.text,
      ),
    ).toEqual(["", "body text", "field"]);
    expect(artifacts.scopedText[0]?.text).toBe("\nbody text\nfield");
    expect(artifacts.verifySurfaces.scopeInstrSurfaces.map((surface) => surface.text)).toEqual([
      `HYPERLINK "mailto:field@example.invalid"`,
      `HYPERLINK "mailto:instr@example.invalid"`,
    ]);
    expect(artifacts.verifySurfaces.relsTargetSurfaces).toEqual([
      {
        kind: "rels-target",
        path: "word/_rels/document.xml.rels",
        text: "mailto:rel@example.invalid",
      },
    ]);
    expect(artifacts.verifySurfaces.scopesChecked).toBe(5);
  });
});
