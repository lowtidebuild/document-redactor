import JSZip from "jszip";

import { MAX_ENTRY_BYTES, MAX_INPUT_BYTES } from "./limits.js";

export class FileTooLargeError extends Error {
  constructor(size: number, limit: number) {
    super(`File size ${size} bytes exceeds limit of ${limit} bytes`);
    this.name = "FileTooLargeError";
  }
}

export class EntryTooLargeError extends Error {
  constructor(path: string, size: number, limit: number) {
    super(`ZIP entry "${path}" decompressed to ${size} bytes, exceeds limit of ${limit} bytes`);
    this.name = "EntryTooLargeError";
  }
}

export class CorruptDocxError extends Error {
  constructor() {
    super("File is not a readable ZIP/DOCX package");
    this.name = "CorruptDocxError";
  }
}

export class InvalidDocxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDocxError";
  }
}

export async function loadDocxZip(bytes: Uint8Array): Promise<JSZip> {
  if (bytes.length === 0) {
    throw new FileTooLargeError(0, MAX_INPUT_BYTES);
  }
  if (bytes.length > MAX_INPUT_BYTES) {
    throw new FileTooLargeError(bytes.length, MAX_INPUT_BYTES);
  }
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes.slice());
  } catch {
    throw new CorruptDocxError();
  }
  validateDocxPackage(zip);
  return zip;
}

export async function readZipEntry(
  zip: JSZip,
  path: string,
): Promise<string> {
  const file = zip.file(path);
  if (file === null) {
    throw new Error(`ZIP entry not found: ${path}`);
  }
  const content = await file.async("string");
  if (content.length > MAX_ENTRY_BYTES) {
    throw new EntryTooLargeError(path, content.length, MAX_ENTRY_BYTES);
  }
  return content;
}

function validateDocxPackage(zip: JSZip): void {
  if (zip.file("[Content_Types].xml") === null) {
    throw new InvalidDocxError(
      'Unsupported DOCX package: missing "[Content_Types].xml"',
    );
  }
  if (zip.file("word/document.xml") === null) {
    throw new InvalidDocxError(
      'Unsupported DOCX package: missing "word/document.xml"',
    );
  }
}
