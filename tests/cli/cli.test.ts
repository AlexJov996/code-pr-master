import { describe, expect, test } from "vitest";
import { diffCommandFor, exitCodeFor } from "../../src/cli/options.js";
import type { ReviewResult } from "../../src/core/schema.js";

describe("diffCommandFor", () => {
  test("defaults to comparing the base branch with HEAD using a merge base", () => {
    expect(diffCommandFor({})).toEqual(["git", "diff", "main...HEAD"]);
    expect(diffCommandFor({ base: "origin/develop" })).toEqual(["git", "diff", "origin/develop...HEAD"]);
  });

  test("supports staged and working-tree diffs", () => {
    expect(diffCommandFor({ staged: true })).toEqual(["git", "diff", "--staged"]);
    expect(diffCommandFor({ working: true })).toEqual(["git", "diff", "HEAD"]);
  });

  test("staged wins over base when both are given", () => {
    expect(diffCommandFor({ staged: true, base: "main" })).toEqual(["git", "diff", "--staged"]);
  });
});

describe("exitCodeFor", () => {
  const mk = (severities: Array<"Critical" | "Major" | "Minor" | "Nitpick">): ReviewResult => ({
    walkthrough: "w", changes: [], effort: 1, checks: [], generalComments: [], model: "m", profile: "chill",
    findings: severities.map((severity, i) => ({ path: "a.ts", line: i + 1, category: "Security", severity, effort: "Quick win", title: "t", body: "b", agent_prompt: "p" })),
  });

  test("fails only at or above the chosen severity", () => {
    expect(exitCodeFor(mk(["Minor"]), "critical")).toBe(0);
    expect(exitCodeFor(mk(["Critical"]), "critical")).toBe(1);
    expect(exitCodeFor(mk(["Major"]), "critical")).toBe(0);
    expect(exitCodeFor(mk(["Major"]), "major")).toBe(1);
    expect(exitCodeFor(mk(["Minor"]), "minor")).toBe(1);
    expect(exitCodeFor(mk(["Critical"]), "none")).toBe(0);
  });
});
