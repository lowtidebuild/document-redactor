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

export async function loadDocxZip(bytes: Uint8Array): Promise<JSZip> {
  if (bytes.length === 0) {
    throw new FileTooLargeError(0, MAX_INPUT_BYTES);
  }
  if (bytes.length > MAX_INPUT_BYTES) {
    throw new FileTooLargeError(bytes.length, MAX_INPUT_BYTES);
  }
  return JSZip.loadAsync(bytes.slice());
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
