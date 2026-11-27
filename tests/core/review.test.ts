import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { DEFAULT_CONFIG, parseConfig } from "../../src/core/config.js";
import { buildSystemPrompt, buildUserPrompt } from "../../src/core/prompt.js";
import { reviewChanges, type Generate, type ReviewInput } from "../../src/core/review.js";
import type { ReviewOutput } from "../../src/core/schema.js";

const sample = readFileSync(new URL("../fixtures/sample.diff", import.meta.url), "utf8");

function baseOutput(overrides: Partial<ReviewOutput> = {}): ReviewOutput {
  return {
    walkthrough: "Adds cache invalidation.",
    changes: [{ area: "Cache", files: ["src/cache.ts"], summary: "Invalidate on update." }],
    effort: 2,
    findings: [],
    ...overrides,
  };
}

function fakeGenerate(output: ReviewOutput, calls: { system: string; user: string }[] = []): Generate {
  return async (system, user) => {
    calls.push({ system, user });
    return output;
  };
}

const input: ReviewInput = {
  title: "fix(cache): invalidate project key after update",
  description: "Deletes the Redis key so readers see fresh data.",
  diff: sample,
  config: DEFAULT_CONFIG,
};

describe("prompts", () => {
  test("system prompt states the profile and tone", () => {
    const cfg = parseConfig("reviews:\n  profile: assertive\ntone_instructions: Be blunt.\nlanguage: de\n");
    const sys = buildSystemPrompt(cfg);
    expect(sys).toContain("assertive");
    expect(sys).toContain("Be blunt.");
    expect(sys).toContain("de");
  });

  test("user prompt carries title, description, annotated diff and matching path instructions", () => {
    const cfg = parseConfig("reviews:\n  path_instructions:\n    - path: 'src/**'\n      instructions: Watch for cache bugs.\n    - path: 'docs/**'\n      instructions: Not relevant.\n");
    const user = buildUserPrompt({ ...input, config: cfg });
    expect(user).toContain("fix(cache): invalidate project key after update");
    expect(user).toContain("Deletes the Redis key");
    expect(user).toContain("### src/cache.ts (modified, +4/-1)");
    expect(user).toContain("   11 + |   const result");
    expect(user).toContain("Watch for cache bugs.");
    expect(user).not.toContain("Not relevant.");
  });
});

describe("reviewChanges", () => {
  test("excludes files removed by path filters from the prompt", async () => {
    const calls: { system: string; user: string }[] = [];
    const cfg = parseConfig("reviews:\n  path_filters:\n    - '!**/*.md'\n");
    await reviewChanges({ ...input, config: cfg }, { generate: fakeGenerate(baseOutput(), calls) });
    expect(calls[0]!.user).toContain("src/cache.ts");
    expect(calls[0]!.user).not.toContain("README.md");
  });

  test("keeps findings anchored to lines that exist in the diff", async () => {
    const out = baseOutput({
      findings: [{ path: "src/cache.ts", line: 12, category: "Functional Correctness", severity: "Major", effort: "Quick win", title: "T.", body: "B", agent_prompt: "P" }],
    });
    const r = await reviewChanges(input, { generate: fakeGenerate(out) });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.line).toBe(12);
    expect(r.generalComments).toHaveLength(0);
  });

  test("snaps a finding that is off by a few lines onto the nearest diff line", async () => {
    const out = baseOutput({
      findings: [{ path: "src/cache.ts", line: 18, category: "Functional Correctness", severity: "Major", effort: "Quick win", title: "T.", body: "B", agent_prompt: "P" }],
    });
    const r = await reviewChanges(input, { generate: fakeGenerate(out) });
    expect(r.findings[0]!.line).toBe(16);
  });

  test("moves a finding it cannot anchor into general comments", async () => {
    const out = baseOutput({
      findings: [
        { path: "src/cache.ts", line: 400, category: "Security", severity: "Critical", effort: "Moderate", title: "Far away.", body: "B", agent_prompt: "P" },
        { path: "src/missing.ts", line: 1, category: "Security", severity: "Critical", effort: "Moderate", title: "Unknown file.", body: "B", agent_prompt: "P" },
      ],
    });
    const r = await reviewChanges(input, { generate: fakeGenerate(out) });
    expect(r.findings).toHaveLength(0);
    expect(r.generalComments.map((f) => f.title)).toEqual(["Far away.", "Unknown file."]);
  });

  test("applies the profile: chill drops nitpicks, quiet keeps only critical and major", async () => {
    const mk = (severity: "Critical" | "Major" | "Minor" | "Nitpick") => ({
      path: "src/cache.ts", line: 12, category: "Maintainability & Code Quality" as const, severity, effort: "Quick win" as const, title: `${severity}.`, body: "B", agent_prompt: "P",
    });
    const out = baseOutput({ findings: [mk("Critical"), mk("Major"), mk("Minor"), mk("Nitpick")] });
    const chill = await reviewChanges(input, { generate: fakeGenerate(out) });
    expect(chill.findings.map((f) => f.severity)).toEqual(["Critical", "Major", "Minor"]);
    const quiet = await reviewChanges({ ...input, config: parseConfig("reviews:\n  profile: quiet\n") }, { generate: fakeGenerate(out) });
    expect(quiet.findings.map((f) => f.severity)).toEqual(["Critical", "Major"]);
    const assertive = await reviewChanges({ ...input, config: parseConfig("reviews:\n  profile: assertive\n") }, { generate: fakeGenerate(out) });
    expect(assertive.findings).toHaveLength(4);
  });

  test("runs local pre-merge checks on title and description", async () => {
    const r = await reviewChanges({ ...input, title: "wip", description: "" }, { generate: fakeGenerate(baseOutput()) });
    const byName = Object.fromEntries(r.checks.map((c) => [c.name, c.status]));
    expect(byName["Title check"]).toBe("warning");
    expect(byName["Description check"]).toBe("warning");
    const ok = await reviewChanges(input, { generate: fakeGenerate(baseOutput()) });
    expect(ok.checks.every((c) => c.status === "passed")).toBe(true);
  });

  test("returns an empty review without calling the model when nothing is in scope", async () => {
    let called = false;
    const cfg = parseConfig("reviews:\n  path_filters:\n    - 'nothing/**'\n");
    const r = await reviewChanges({ ...input, config: cfg }, { generate: async () => { called = true; return baseOutput(); } });
    expect(called).toBe(false);
    expect(r.findings).toHaveLength(0);
    expect(r.walkthrough).toMatch(/no files/i);
  });
});
