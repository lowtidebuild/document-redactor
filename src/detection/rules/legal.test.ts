import { describe, expect, it } from "vitest";

import { runRegexPhase } from "../_framework/runner.js";
import type { RegexRule } from "../_framework/types.js";

import { LEGAL } from "./legal.js";

function findRule(subcategory: string): RegexRule {
  const rule = LEGAL.find((r) => r.subcategory === subcategory);
  if (!rule) throw new Error(`Rule not found: ${subcategory}`);
  return rule;
}

function matchOne(subcategory: string, text: string): string[] {
  const rule = findRule(subcategory);
  return runRegexPhase(text, "paranoid", [rule]).map((c) => c.text);
}

function expectFast(subcategory: string, input: string, budgetMs = 50): void {
  const start = performance.now();
  void matchOne(subcategory, input);
  const elapsed = performance.now() - start;
  expect(elapsed).toBeLessThan(budgetMs);
}

describe("LEGAL registry", () => {
  it("exports exactly 6 rules", () => {
    expect(LEGAL).toHaveLength(6);
  });

  it("every rule id starts with 'legal.'", () => {
    for (const rule of LEGAL) {
      expect(rule.id.startsWith("legal.")).toBe(true);
    }
  });

  it("every rule pattern has the 'g' flag", () => {
    for (const rule of LEGAL) {
      expect(rule.pattern.flags).toContain("g");
    }
  });

  it("every rule has a non-empty description", () => {
    for (const rule of LEGAL) {
      expect(rule.description.length).toBeGreaterThan(0);
    }
  });
});

describe("legal.ko-case-number", () => {
  it.each([
    ["matches 가합 case numbers", "2024가합12345", ["2024가합12345"]],
    ["matches 나 case numbers", "2023나67890", ["2023나67890"]],
    ["matches 노 case numbers", "2024노1234", ["2024노1234"]],
    ["matches 도 case numbers", "2024도5678", ["2024도5678"]],
    ["matches at the start of the string", "2024가합12345 사건", ["2024가합12345"]],
    ["matches at the end of the string", "사건번호 2024가합12345", ["2024가합12345"]],
    ["matches inside punctuation", "(2024가합12345)", ["2024가합12345"]],
    ["matches 3-syllable case types", "2024구합12345", ["2024구합12345"]],
    ["matches short docket numbers", "2024가1", ["2024가1"]],
    ["rejects year suffixes without dockets", "2024년", []],
    ["rejects out-of-range years", "9999가합12345", []],
    ["rejects ASCII case types", "2024AB12345", []],
  ])("%s", (_name, text, expected) => {
    expect(matchOne("ko-case-number", text)).toEqual(expected);
  });

  it("is ReDoS-safe on long case-number input", () => {
    expectFast("ko-case-number", "2024가".repeat(5000));
  });
});

describe("legal.ko-court-name", () => {
  it.each([
    ["matches 서울중앙지방법원", "서울중앙지방법원", ["서울중앙지방법원"]],
    ["matches 대법원", "대법원", ["대법원"]],
    ["matches 서울고등법원", "서울고등법원", ["서울고등법원"]],
    ["matches 수원지방법원", "수원지방법원", ["수원지방법원"]],
    ["matches 헌법재판소", "헌법재판소", ["헌법재판소"]],
    ["matches 특허법원", "특허법원", ["특허법원"]],
    ["matches at the start of the string", "서울중앙지방법원 관할", ["서울중앙지방법원"]],
    ["matches at the end of the string", "관할은 대법원", ["대법원"]],
    ["matches inside punctuation", "(서울고등법원)", ["서울고등법원"]],
    ["matches 서울중앙지방법원 as one entity", "서울중앙지방법원", ["서울중앙지방법원"]],
    ["rejects bare 법원", "법원", []],
    ["rejects unknown foreign-style regions", "동경지방법원", []],
  ])("%s", (_name, text, expected) => {
    expect(matchOne("ko-court-name", text)).toEqual(expected);
  });

  it("is ReDoS-safe on long court-name input", () => {
    expectFast("ko-court-name", "서울".repeat(5000) + "지방법원");
  });
});

describe("legal.ko-statute-ref", () => {
  it.each([
    ["matches simple article references", "제15조", ["제15조"]],
    ["matches article plus paragraph", "제15조 제2항", ["제15조 제2항"]],
    ["matches law-prefixed articles", "민법 제750조", ["민법 제750조"]],
    ["matches 법률 제N호 forms", "법률 제1234호", ["법률 제1234호"]],
    ["matches spaced law names", "개인정보 보호법 제17조", ["개인정보 보호법 제17조"]],
    ["matches 조의 references", "제15조의2", ["제15조의2"]],
    ["matches hierarchical references", "제15조 제2항 제3호에 따라", ["제15조 제2항 제3호"]],
    ["matches at the start of the string", "민법 제750조에 따르면", ["민법 제750조"]],
    ["matches inside punctuation", "(제15조)", ["제15조"]],
    ["matches short 호 references", "제3호", ["제3호"]],
    ["rejects bare 제", "제", []],
    ["rejects missing 제 prefixes", "15조", []],
  ])("%s", (_name, text, expected) => {
    expect(matchOne("ko-statute-ref", text)).toEqual(expected);
  });

  it("is ReDoS-safe on long statute input", () => {
    expectFast("ko-statute-ref", "제1조 ".repeat(4000));
  });
});

describe("legal.en-case-citation", () => {
  it.each([
    ["matches F.3d citations", "123 F.3d 456", ["123 F.3d 456"]],
    ["matches U.S. citations", "456 U.S. 789", ["456 U.S. 789"]],
    ["matches S. Ct. citations", "789 S. Ct. 123", ["789 S. Ct. 123"]],
    ["matches Cal. App. citations", "100 Cal. App. 4th 200", ["100 Cal. App. 4th 200"]],
    ["matches F. Supp. citations", "12 F. Supp. 3d 456", ["12 F. Supp. 3d 456"]],
    ["matches A.2d citations", "77 A. 2d 88", ["77 A. 2d 88"]],
    ["matches at the start of the string", "123 F.3d 456 held that", ["123 F.3d 456"]],
    ["matches at the end of the string", "See 456 U.S. 789", ["456 U.S. 789"]],
    ["matches inside punctuation", "(789 S. Ct. 123)", ["789 S. Ct. 123"]],
    ["matches reporter variants with spacing", "77 S. Ct. 88", ["77 S. Ct. 88"]],
    ["rejects bare reporter abbreviations", "F.3d", []],
    ["rejects plain digit pairs", "123 456", []],
  ])("%s", (_name, text, expected) => {
    expect(matchOne("en-case-citation", text)).toEqual(expected);
  });

  it("is ReDoS-safe on long citation input", () => {
    expectFast("en-case-citation", "123 F.3d ".repeat(3000));
  });
});

describe("legal.en-statute-ref", () => {
  it.each([
    ["matches Section references", "Section 230", ["Section 230"]],
    ["matches U.S.C. references", "17 U.S.C. § 101", ["17 U.S.C. § 101"]],
    ["matches larger U.S.C. references", "42 U.S.C. § 1983", ["42 U.S.C. § 1983"]],
    ["matches decimal sections", "Section 10.1", ["Section 10.1"]],
    ["matches parenthetical sections", "Section 10.1(a)", ["Section 10.1(a)"]],
    ["matches inside punctuation", "(17 U.S.C. § 101)", ["17 U.S.C. § 101"]],
    ["matches at the start of the string", "Section 230 applies", ["Section 230"]],
    ["matches at the end of the string", "See 42 U.S.C. § 1983", ["42 U.S.C. § 1983"]],
    ["matches U.S.C. without title numbers", "U.S.C. § 101", ["U.S.C. § 101"]],
    ["matches zero-padded sections", "Section 007", ["Section 007"]],
    ["rejects bare Section labels", "Section", []],
    ["rejects bare section signs", "§ 101", []],
  ])("%s", (_name, text, expected) => {
    expect(matchOne("en-statute-ref", text)).toEqual(expected);
  });

  it("is ReDoS-safe on long statute-reference input", () => {
    expectFast("en-statute-ref", "Section 1 ".repeat(4000));
  });
});

describe("legal.legal-context", () => {
  it.each([
    ["matches Korean case-number labels", "사건번호:2024가합12345", ["2024가합12345"]],
    ["matches English Case No. labels", "Case No.123-CV-456", ["123-CV-456"]],
    ["matches Court labels", "Court:Seoul Central District Court", ["Seoul Central District Court"]],
    ["matches Docket No. labels", "Docket No.123-456", ["123-456"]],
    ["matches 법원 labels", "법원:서울중앙지방법원", ["서울중앙지방법원"]],
    ["matches at the start of the string", "Docket No.123-456, status", ["123-456"]],
    ["matches up to commas", "Docket No.123-456, filed", ["123-456"]],
    ["matches up to semicolons", "Court:Supreme Court; docket follows", ["Supreme Court"]],
    ["matches up to newlines", "Docket No.123-456\nNext line", ["123-456"]],
    ["matches generic 사건 labels", "사건:2024가합12345", ["2024가합12345"]],
    ["rejects labels without values", "사건번호", []],
    ["rejects values longer than the cap", "Case No.: " + "A".repeat(80), []],
  ])("%s", (_name, text, expected) => {
    expect(matchOne("legal-context", text)).toEqual(expected);
  });

  it("is ReDoS-safe on long legal-context input", () => {
    expectFast("legal-context", "Case No.: " + "A".repeat(10000), 100);
  });
});
