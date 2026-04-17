import JSZip from "jszip";

import { MAX_INPUT_BYTES } from "./limits.js";

export class FileTooLargeError extends Error {
  constructor(size: number, limit: number) {
    super(`File size ${size} bytes exceeds limit of ${limit} bytes`);
    this.name = "FileTooLargeError";
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
