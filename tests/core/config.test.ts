import { describe, expect, test } from "vitest";
import { DEFAULT_CONFIG, matchesPathFilters, parseConfig, instructionsForPath } from "../../src/core/config.js";

describe("parseConfig", () => {
  test("returns defaults for empty input", () => {
    const cfg = parseConfig("");
    expect(cfg).toEqual(DEFAULT_CONFIG);
    expect(cfg.reviews.profile).toBe("chill");
    expect(cfg.reviews.auto_review.enabled).toBe(true);
    expect(cfg.reviews.auto_review.drafts).toBe(false);
  });

  test("overrides nested fields and keeps the rest default", () => {
    const cfg = parseConfig(`
language: de
reviews:
  profile: assertive
  path_filters:
    - "!**/*.lock"
    - "src/**"
  path_instructions:
    - path: "src/api/**"
      instructions: "Check every handler validates its input."
tone_instructions: "Be terse."
`);
    expect(cfg.language).toBe("de");
    expect(cfg.reviews.profile).toBe("assertive");
    expect(cfg.reviews.path_filters).toEqual(["!**/*.lock", "src/**"]);
    expect(cfg.reviews.auto_review.enabled).toBe(true);
    expect(cfg.tone_instructions).toBe("Be terse.");
  });

  test("rejects an unknown profile with a readable error", () => {
    expect(() => parseConfig("reviews:\n  profile: loud\n")).toThrow(/profile/);
  });
});

describe("matchesPathFilters", () => {
  test("no filters means every path is included", () => {
    expect(matchesPathFilters("anything/at/all.ts", [])).toBe(true);
  });

  test("negated globs exclude, positive globs include", () => {
    const filters = ["!**/*.lock", "!dist/**", "src/**"];
    expect(matchesPathFilters("pnpm-lock.yaml", filters)).toBe(false);
    expect(matchesPathFilters("src/a.lock", filters)).toBe(false);
    expect(matchesPathFilters("dist/bundle.js", filters)).toBe(false);
    expect(matchesPathFilters("src/core/diff.ts", filters)).toBe(true);
    expect(matchesPathFilters("docs/readme.md", filters)).toBe(false);
  });

  test("only negated filters means everything else is included", () => {
    expect(matchesPathFilters("src/a.ts", ["!**/*.snap"])).toBe(true);
    expect(matchesPathFilters("tests/a.snap", ["!**/*.snap"])).toBe(false);
  });
});

describe("instructionsForPath", () => {
  test("collects instructions whose glob matches the path, in order", () => {
    const rules = [
      { path: "src/**", instructions: "general" },
      { path: "src/api/**", instructions: "api" },
      { path: "tests/**", instructions: "tests" },
    ];
    expect(instructionsForPath("src/api/users.ts", rules)).toEqual(["general", "api"]);
    expect(instructionsForPath("README.md", rules)).toEqual([]);
  });
});
