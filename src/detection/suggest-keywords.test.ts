import { describe, it, expect } from "vitest";

import { suggestKeywords } from "./suggest-keywords.js";

/** Repeat a phrase `n` times inside a sentence so it crosses the frequency floor. */
function repeated(phrase: string, n: number): string {
  return Array.from({ length: n }, (_, i) => `Para ${i}: ${phrase}.`).join("\n");
}

describe("suggestKeywords — Rule 1: English Title Case", () => {
  it("suggests a Title Case bigram that appears ≥5 times", () => {
    const text = repeated("Project Falcon is the codename", 6);
    const out = suggestKeywords(text);
    expect(out).toContain("Project Falcon");
  });

  it("rejects a Title Case bigram that appears <5 times", () => {
    const text = repeated("Zephyr Alpha", 3);
    const out = suggestKeywords(text);
    expect(out).not.toContain("Zephyr Alpha");
  });

  it("captures multi-word Title Case (3+ words)", () => {
    const text = repeated("Blue Wing Two", 5);
    const out = suggestKeywords(text);
    expect(out).toContain("Blue Wing Two");
  });
});

describe("suggestKeywords — Rule 2: Project/brand prefix (multilingual)", () => {
  it("suggests a Korean 프로젝트-prefixed phrase", () => {
    const text = repeated("프로젝트 블루윙은 우리의 신제품이다", 6);
    const out = suggestKeywords(text);
    expect(out.some((s) => s.includes("블루윙"))).toBe(true);
  });

  it("suggests a Korean 코드명-prefixed phrase", () => {
    const text = repeated("코드명 매그놀리아는 비밀 프로젝트이다", 6);
    const out = suggestKeywords(text);
    expect(out.some((s) => s.includes("매그놀리아"))).toBe(true);
  });

  it("suggests an English 'Project X' bigram via the prefix rule", () => {
    const text = repeated("The team built Project Helios for", 5);
    const out = suggestKeywords(text);
    expect(out.some((s) => s.toLowerCase().includes("helios"))).toBe(true);
  });
});

describe("suggestKeywords — Rule 3: Version-suffixed token", () => {
  it("suggests a token with a semver-style version suffix", () => {
    const text = repeated("We deployed Falcon 2.0 yesterday", 5);
    const out = suggestKeywords(text);
    expect(out.some((s) => s.toLowerCase().includes("falcon"))).toBe(true);
  });

  it("suggests a token with a 'v3' suffix", () => {
    const text = repeated("Atlas v3 ships next quarter", 5);
    const out = suggestKeywords(text);
    expect(out.some((s) => s.toLowerCase().includes("atlas"))).toBe(true);
  });

  it("suggests a Korean phrase with a semver suffix", () => {
    const text = repeated("블루윙 2.0 출시 예정", 5);
    const out = suggestKeywords(text);
    expect(out.some((s) => s.includes("블루윙"))).toBe(true);
  });
});

describe("suggestKeywords — Rule 4: Quoted phrase (≥3 occurrences)", () => {
  it("suggests a phrase quoted in straight double quotes ≥3 times", () => {
    const text =
      'The "Eagle" project. Per the "Eagle" plan. Reviewed the "Eagle" docs.';
    const out = suggestKeywords(text);
    expect(out).toContain("Eagle");
  });

  it("suggests a phrase quoted in Korean corner brackets", () => {
    const text = "「블루윙」 회의록. 「블루윙」 일정. 「블루윙」 보고서.";
    const out = suggestKeywords(text);
    expect(out).toContain("블루윙");
  });

  it("rejects quoted phrases that appear only twice", () => {
    const text = '"Once" and "Once" only.';
    const out = suggestKeywords(text);
    expect(out).not.toContain("Once");
  });
});

describe("suggestKeywords — Rule 5: Frequency floor + length floor", () => {
  it("rejects a 1-character match even if it appears often", () => {
    // The Title Case rule won't fire on a 1-char string anyway, but the
    // length guard is a belt-and-suspenders check.
    const text = repeated("X", 10);
    const out = suggestKeywords(text);
    expect(out).not.toContain("X");
  });
});

describe("suggestKeywords — exclusions", () => {
  it("excludes STOP_PHRASES even if they cross the frequency floor", () => {
    // "Section" is in STOP_PHRASE_LITERALS — must never be suggested.
    const text = repeated("Section A and Section B and Section C", 10);
    const out = suggestKeywords(text);
    expect(out).not.toContain("Section");
  });

  it("excludes the Korean clause numbering form 제 N 조", () => {
    const text = repeated("제 1 조 정의", 10);
    const out = suggestKeywords(text);
    for (const s of out) {
      expect(s).not.toMatch(/^제 ?\d+ ?조$/);
    }
  });

  it("respects the user-provided exclude list", () => {
    const text = repeated("Project Falcon", 6);
    const out = suggestKeywords(text, { exclude: ["Project Falcon"] });
    expect(out).not.toContain("Project Falcon");
  });

  it("excludes is case-sensitive on exact match", () => {
    const text = repeated("Project Falcon", 6);
    const out = suggestKeywords(text, { exclude: ["project falcon"] });
    // Different case → still suggested
    expect(out).toContain("Project Falcon");
  });
});

describe("suggestKeywords — output shape", () => {
  it("returns an empty array for empty input", () => {
    expect(suggestKeywords("")).toEqual([]);
  });

  it("returns an empty array when nothing crosses the threshold", () => {
    expect(suggestKeywords("Just a few words here.")).toEqual([]);
  });

  it("dedupes identical suggestions", () => {
    const text = repeated("Project Falcon", 6);
    const out = suggestKeywords(text);
    expect(out.filter((s) => s === "Project Falcon")).toHaveLength(1);
  });

  it("respects a custom minFrequency", () => {
    const text = repeated("Project Falcon", 3);
    // Default floor is 5 → no suggestion
    expect(suggestKeywords(text)).not.toContain("Project Falcon");
    // Lower the floor to 3 → suggested
    expect(suggestKeywords(text, { minFrequency: 3 })).toContain(
      "Project Falcon",
    );
  });

  it("respects a custom quotedMinFrequency", () => {
    const text = '"Eagle" once. "Eagle" twice.';
    expect(suggestKeywords(text)).not.toContain("Eagle");
    expect(suggestKeywords(text, { quotedMinFrequency: 2 })).toContain("Eagle");
  });
});
