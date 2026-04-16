import type { PositionMap } from "../normalize.js";

export function recoverOriginalSlice(
  originalText: string,
  map: PositionMap,
  startNorm: number,
  endNorm: number,
): string {
  return originalText.slice(map.origOffsets[startNorm], map.origOffsets[endNorm]);
}
