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

describe("triage config", () => {
  test("defaults to no saved views and the standard CODEOWNERS locations", () => {
    const cfg = parseConfig("");
    expect(cfg.triage.saved_views).toEqual([]);
    expect(cfg.triage.ai_assessment).toBe(false);
  });

  test("parses saved views with filters", () => {
    const cfg = parseConfig(`
triage:
  ai_assessment: true
  saved_views:
    - id: security-watch
      name: Security watch
      filter:
        risk: [High]
        paths: ["auth/**"]
    - id: release-train
      name: Release train
      filter:
        base_branches: ["release/*"]
`);
    expect(cfg.triage.ai_assessment).toBe(true);
    expect(cfg.triage.saved_views[0]).toEqual({ id: "security-watch", name: "Security watch", filter: { risk: ["High"], paths: ["auth/**"] } });
    expect(cfg.triage.saved_views[1]!.filter.base_branches).toEqual(["release/*"]);
  });

  test("rejects an invalid risk level in a saved view", () => {
    expect(() => parseConfig("triage:\n  saved_views:\n    - id: x\n      name: X\n      filter:\n        risk: [Huge]\n")).toThrow(/risk/);
  });
});

describe("security config", () => {
  test("defaults: PR scans on, auto-fix off, minimum severity Medium, standard excludes", () => {
    const cfg = parseConfig("");
    expect(cfg.security.pr_scans).toBe(true);
    expect(cfg.security.auto_fix).toBe(false);
    expect(cfg.security.min_severity).toBe("Medium");
    expect(cfg.security.exclude).toContain("**/node_modules/**");
  });

  test("overrides", () => {
    const cfg = parseConfig("security:\n  pr_scans: false\n  auto_fix: true\n  min_severity: High\n  exclude: ['legacy/**']\n");
    expect(cfg.security.pr_scans).toBe(false);
    expect(cfg.security.auto_fix).toBe(true);
    expect(cfg.security.min_severity).toBe("High");
    expect(cfg.security.exclude).toEqual(["legacy/**"]);
  });
});
