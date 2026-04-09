import { describe, it, expect } from "vitest";

import { PII_PATTERNS, PII_KINDS, type PiiKind } from "./patterns.js";

/** Run a regex against a sample and return all matches as a string array. */
function matches(kind: PiiKind, sample: string): string[] {
  const re = new RegExp(PII_PATTERNS[kind].source, PII_PATTERNS[kind].flags);
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(sample)) !== null) out.push(m[0]);
  return out;
}

describe("PII_PATTERNS", () => {
  it("exports a pattern for every PiiKind in PII_KINDS", () => {
    for (const kind of PII_KINDS) {
      expect(PII_PATTERNS[kind]).toBeInstanceOf(RegExp);
      expect(PII_PATTERNS[kind].flags).toContain("g");
    }
  });
});

describe("주민등록번호 (rrn)", () => {
  it("matches the canonical 6-7 form", () => {
    expect(matches("rrn", "주민번호: 900101-1234567 입니다.")).toEqual([
      "900101-1234567",
    ]);
  });

  it("rejects 7th-digit codes outside 1-4 (gender code)", () => {
    expect(matches("rrn", "900101-9234567")).toEqual([]);
    expect(matches("rrn", "900101-0234567")).toEqual([]);
  });

  it("does not match a longer digit run that contains an RRN-shaped substring", () => {
    expect(matches("rrn", "1234900101-12345678")).toEqual([]);
    expect(matches("rrn", "900101-12345678")).toEqual([]);
  });

  it("matches multiple RRNs in the same paragraph", () => {
    expect(matches("rrn", "A: 900101-1234567, B: 850515-2345678")).toEqual([
      "900101-1234567",
      "850515-2345678",
    ]);
  });
});

describe("사업자등록번호 (brn)", () => {
  it("matches the canonical 3-2-5 form", () => {
    expect(matches("brn", "사업자번호 123-45-67890 입니다.")).toEqual([
      "123-45-67890",
    ]);
  });

  it("does not match against a longer surrounding digit run", () => {
    expect(matches("brn", "9123-45-67890")).toEqual([]);
    expect(matches("brn", "123-45-678901")).toEqual([]);
  });
});

describe("EIN (US employer identification)", () => {
  it("matches the 2-7 form", () => {
    expect(matches("ein", "EIN 12-3456789 (US)")).toEqual(["12-3456789"]);
  });

  it("does not match adjacent digits", () => {
    expect(matches("ein", "112-3456789")).toEqual([]);
    expect(matches("ein", "12-34567890")).toEqual([]);
  });
});

describe("Korean mobile phone (phone-kr)", () => {
  it("matches 010-XXXX-XXXX", () => {
    expect(matches("phone-kr", "전화: 010-1234-5678 까지")).toEqual([
      "010-1234-5678",
    ]);
  });

  it("matches 011/016/017/018/019 prefixes", () => {
    for (const p of ["011", "016", "017", "018", "019"]) {
      expect(matches("phone-kr", `${p}-1234-5678`)).toEqual([
        `${p}-1234-5678`,
      ]);
    }
  });

  it("matches without dashes", () => {
    expect(matches("phone-kr", "01012345678")).toEqual(["01012345678"]);
  });

  it("matches a 7-digit subscriber form (older numbers)", () => {
    expect(matches("phone-kr", "010-123-4567")).toEqual(["010-123-4567"]);
  });

  it("rejects non-mobile prefixes", () => {
    expect(matches("phone-kr", "012-1234-5678")).toEqual([]);
    expect(matches("phone-kr", "020-1234-5678")).toEqual([]);
  });
});

describe("International phone (phone-intl)", () => {
  it("matches +1 with US-style spacing", () => {
    expect(matches("phone-intl", "Call +1 415 555 0199 anytime.")).toEqual([
      "+1 415 555 0199",
    ]);
  });

  it("matches +82 with Korean-style spacing", () => {
    expect(matches("phone-intl", "Call +82 10 1234 5678")).toEqual([
      "+82 10 1234 5678",
    ]);
  });

  it("matches when separated by hyphens", () => {
    expect(matches("phone-intl", "Call +1-415-555-0199")).toEqual([
      "+1-415-555-0199",
    ]);
  });

  it("does not match a bare + that isn't a phone", () => {
    expect(matches("phone-intl", "version+1.2.3")).toEqual([]);
  });
});

describe("email", () => {
  it("matches a typical email", () => {
    expect(matches("email", "Contact kim@abc-corp.kr today.")).toEqual([
      "kim@abc-corp.kr",
    ]);
  });

  it("matches plus addressing", () => {
    expect(matches("email", "alice+invoice@example.com")).toEqual([
      "alice+invoice@example.com",
    ]);
  });

  it("matches multiple emails", () => {
    expect(
      matches("email", "from kim@abc.kr and legal@sunrise.com both"),
    ).toEqual(["kim@abc.kr", "legal@sunrise.com"]);
  });

  it("rejects strings without a TLD", () => {
    expect(matches("email", "just text@no")).toEqual([]);
  });
});

describe("Korean bank account (account-kr)", () => {
  it("matches typical 4-3-6 forms used by Korean banks", () => {
    expect(matches("account-kr", "계좌: 1002-123-456789")).toEqual([
      "1002-123-456789",
    ]);
  });

  it("matches 3-2-6 forms", () => {
    expect(matches("account-kr", "계좌 110-22-345678")).toEqual([
      "110-22-345678",
    ]);
  });
});

describe("credit card (card)", () => {
  it("matches a 16-digit Visa with spaces", () => {
    expect(matches("card", "Card: 4111 1111 1111 1111")).toEqual([
      "4111 1111 1111 1111",
    ]);
  });

  it("matches a 16-digit card with hyphens", () => {
    expect(matches("card", "Card: 4111-1111-1111-1111")).toEqual([
      "4111-1111-1111-1111",
    ]);
  });

  it("matches contiguous 16 digits", () => {
    expect(matches("card", "Card: 4111111111111111")).toEqual([
      "4111111111111111",
    ]);
  });

  it("does not match a digit run longer than 19", () => {
    expect(matches("card", "12345678901234567890")).toEqual([]);
  });
});

describe("regex hardening (ReDoS / catastrophic backtracking)", () => {
  it("all patterns terminate quickly on adversarial input", () => {
    // 1k-character strings with no actual matches.
    const adversarial = "1".repeat(1000) + "X" + "@".repeat(50);
    const t0 = Date.now();
    for (const kind of PII_KINDS) {
      matches(kind, adversarial);
    }
    const elapsed = Date.now() - t0;
    // 100ms is generous; well-bounded patterns finish in <10ms.
    expect(elapsed).toBeLessThan(500);
  });
});
