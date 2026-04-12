/**
 * Luhn (mod-10) checksum for credit card validation.
 *
 * Used as the postFilter for the credit-card rule in rules/identifiers.ts.
 * Extracted from detect-pii.ts during Phase 0 refactor so both the new rule
 * framework and the legacy shim can import it without duplication.
 *
 * Operates on the digit characters of the input string (skips spaces, hyphens,
 * and any other non-digit chars). Returns true if the digit sequence is
 * Luhn-valid, false otherwise. Empty string and all-non-digit strings return
 * false.
 */
export function luhnCheck(s: string): boolean {
  let sum = 0;
  let alt = false;
  // Iterate from right to left.
  for (let i = s.length - 1; i >= 0; i--) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) continue; // skip non-digits (spaces, hyphens)
    let d = c - 48;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum > 0 && sum % 10 === 0;
}
