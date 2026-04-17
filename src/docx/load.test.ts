import { describe, expect, it, vi, afterEach } from "vitest";
import JSZip from "jszip";

import { MAX_INPUT_BYTES } from "./limits.js";
import { FileTooLargeError, loadDocxZip } from "./load.js";

async function makeZipBytes(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadDocxZip", () => {
  it("rejects empty bytes", async () => {
    await expect(loadDocxZip(new Uint8Array(0))).rejects.toBeInstanceOf(
      FileTooLargeError,
    );
  });

  it("accepts a valid docx-sized zip", async () => {
    const bytes = await makeZipBytes();
    const zip = await loadDocxZip(bytes);
    expect(zip.file("word/document.xml")).not.toBeNull();
  });

  it("accepts the exact MAX_INPUT_BYTES boundary and delegates to JSZip", async () => {
    const zip = new JSZip();
    const spy = vi.spyOn(JSZip, "loadAsync").mockResolvedValue(zip);
    const bytes = new Uint8Array(MAX_INPUT_BYTES);

    await expect(loadDocxZip(bytes)).resolves.toBe(zip);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("rejects bytes larger than MAX_INPUT_BYTES", async () => {
    const spy = vi.spyOn(JSZip, "loadAsync");
    const bytes = new Uint8Array(MAX_INPUT_BYTES + 1);

    await expect(loadDocxZip(bytes)).rejects.toBeInstanceOf(FileTooLargeError);
    expect(spy).not.toHaveBeenCalled();
  });

  it("propagates JSZip errors for corrupt ZIP data", async () => {
    await expect(loadDocxZip(new Uint8Array([1, 2, 3, 4]))).rejects.not.toBeInstanceOf(
      FileTooLargeError,
    );
  });
});
