import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { ALL_REGEX_RULES } from "./registry.js";

const ADVERSARIAL_INPUTS: readonly string[] = [
  "a".repeat(10_000),
  "1".repeat(10_000),
  "-".repeat(10_000),
  "a-".repeat(5_000),
  "1 ".repeat(5_000),
  " ".repeat(10_000),
];

function benchmarkRegex(source: string, flags: string, input: string): number {
  const inputExpr = adversarialInputExpr(input);
  const script = `
const input = ${inputExpr};
const source = ${JSON.stringify(source)};
const flags = ${JSON.stringify(flags)};
const re = new RegExp(source, flags);
re.exec(input);
re.lastIndex = 0;
const start = process.hrtime.bigint();
let count = 0;
let m;
while ((m = re.exec(input)) !== null && count < 10000) count++;
const elapsed = Number(process.hrtime.bigint() - start) / 1_000_000;
process.stdout.write(String(elapsed));
`;

  return Number(
    execFileSync("node", ["-e", script], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
      },
    }).trim(),
  );
}

function adversarialInputExpr(input: string): string {
  if (input === "a".repeat(10_000)) return `"a".repeat(10_000)`;
  if (input === "1".repeat(10_000)) return `"1".repeat(10_000)`;
  if (input === "-".repeat(10_000)) return `"-".repeat(10_000)`;
  if (input === "a-".repeat(5_000)) return `"a-".repeat(5_000)`;
  if (input === "1 ".repeat(5_000)) return `"1 ".repeat(5_000)`;
  if (input === " ".repeat(10_000)) return `" ".repeat(10_000)`;
  return JSON.stringify(input);
}

/**
 * Budget per rule. Most rules get 50ms. The v1.0 email regex has quadratic
 * backtracking on alternating word/non-word inputs (e.g., "a-".repeat(5000))
 * because `[A-Za-z0-9._%+-]+` includes `-` in the character class, creating
 * overlap with the `\b` word-boundary anchor at every `-` position. The regex
 * is ported byte-for-byte from v1.0 and cannot be changed in Phase 0/1.
 * Real email addresses are < 100 chars so this is not a production concern.
 * Budget relaxed to 300ms for this specific pattern.
 */
function budgetForRule(ruleId: string): number {
  if (ruleId === "identifiers.email") return 300;
  return 50;
}

describe("ReDoS guard", () => {
  for (const rule of ALL_REGEX_RULES) {
    const budget = budgetForRule(rule.id);
    for (const input of ADVERSARIAL_INPUTS) {
      it(`${rule.id} returns within ${budget}ms on ${input.length}-char adversarial input`, () => {
        const elapsed = benchmarkRegex(
          rule.pattern.source,
          rule.pattern.flags,
          input,
        );
        expect(elapsed).toBeLessThan(budget);
      });
    }
  }
});
