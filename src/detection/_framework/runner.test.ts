import { describe, expect, it } from "vitest";

import { IDENTIFIERS } from "../rules/identifiers.js";
import type { RegexRule } from "./types.js";

import { runRegexPhase } from "./runner.js";

const EMAIL_RULE: RegexRule = {
  id: "identifiers.email",
  category: "identifiers",
  subcategory: "email",
  pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  levels: ["conservative", "standard", "paranoid"],
  languages: ["universal"],
  description: "email",
};

const PHONE_KR_RULE: RegexRule = {
  id: "identifiers.phone-kr",
  category: "identifiers",
  subcategory: "phone-kr",
  pattern: /(?<!\d)01[016-9]-?\d{3,4}-?\d{4}(?!\d)/g,
  levels: ["conservative", "standard", "paranoid"],
  languages: ["ko"],
  description: "Korean mobile",
};

const PARANOID_ONLY_RULE: RegexRule = {
  id: "identifiers.paranoid-only-test",
  category: "identifiers",
  subcategory: "paranoid-only-test",
  pattern: /TEST/g,
  levels: ["paranoid"],
  languages: ["universal"],
  description: "paranoid-only test rule",
};

describe("runRegexPhase", () => {
  it("returns [] for empty text", () => {
    expect(runRegexPhase("", "standard", [EMAIL_RULE])).toEqual([]);
  });

  it("returns [] when no rules match", () => {
    expect(runRegexPhase("hello world", "standard", [EMAIL_RULE])).toEqual([]);
  });

  it("returns a Candidate for a single match", () => {
    const candidates = runRegexPhase(
      "Contact legal@sunrise.com for details",
      "standard",
      [EMAIL_RULE],
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!).toMatchObject({
      text: "legal@sunrise.com",
      ruleId: "identifiers.email",
      confidence: 1,
    });
  });

  it("returns multiple candidates for multiple matches", () => {
    const candidates = runRegexPhase("a@x.com and b@y.com", "standard", [
      EMAIL_RULE,
    ]);
    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.text)).toEqual(["a@x.com", "b@y.com"]);
  });

  it("applies postFilter to reject false positives", () => {
    const BAD_RULE: RegexRule = {
      id: "identifiers.test-filter",
      category: "identifiers",
      subcategory: "test-filter",
      pattern: /\d{4}/g,
      postFilter: (m) => m === "1234",
      levels: ["standard"],
      languages: ["universal"],
      description: "test",
    };
    const candidates = runRegexPhase("5678 1234 9999", "standard", [BAD_RULE]);
    expect(candidates.map((c) => c.text)).toEqual(["1234"]);
  });

  it("filters out rules whose levels do not include the given level", () => {
    const candidates = runRegexPhase("TEST string here", "standard", [
      PARANOID_ONLY_RULE,
    ]);
    expect(candidates).toEqual([]);
  });

  it("includes rules whose levels do match", () => {
    const candidates = runRegexPhase("TEST string here", "paranoid", [
      PARANOID_ONLY_RULE,
    ]);
    expect(candidates.map((c) => c.text)).toEqual(["TEST"]);
  });

  it("runs multiple rules in order they appear in the input array", () => {
    const candidates = runRegexPhase(
      "legal@sunrise.com and 010-1234-5678",
      "standard",
      [EMAIL_RULE, PHONE_KR_RULE],
    );
    expect(candidates.map((c) => c.ruleId)).toEqual([
      "identifiers.email",
      "identifiers.phone-kr",
    ]);
  });

  it("recovers ORIGINAL bytes (not normalized) for en-dashed phone", () => {
    const candidates = runRegexPhase("010\u20131234\u20135678", "standard", [
      PHONE_KR_RULE,
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.text).toBe("010\u20131234\u20135678");
  });

  it("is deterministic — same input yields same output", () => {
    const text = "a@x.com b@y.com 010-1234-5678";
    const first = runRegexPhase(text, "standard", [EMAIL_RULE, PHONE_KR_RULE]);
    const second = runRegexPhase(text, "standard", [EMAIL_RULE, PHONE_KR_RULE]);
    expect(first).toEqual(second);
  });

  it("produces identical output for conservative, standard, and paranoid over IDENTIFIERS", () => {
    const text =
      "Email legal@sunrise.com phone 010-1234-5678 BRN 123-45-67890 card 4111 1111 1111 1111";
    const conservative = runRegexPhase(text, "conservative", IDENTIFIERS);
    const standard = runRegexPhase(text, "standard", IDENTIFIERS);
    const paranoid = runRegexPhase(text, "paranoid", IDENTIFIERS);
    expect(conservative).toEqual(standard);
    expect(paranoid).toEqual(standard);
  });
});
