import { describe, expect, test } from "vitest";
import { ReviewOutputSchema, type Finding, type ReviewResult } from "../../src/core/schema.js";
import { SUMMARY_MARKER, renderInlineComment, renderSummaryComment, renderTerminalReport } from "../../src/core/format.js";

const finding: Finding = {
  path: "src/cache.ts",
  line: 12,
  category: "Functional Correctness",
  severity: "Major",
  effort: "Quick win",
  title: "Cache is invalidated before the transaction commits.",
  body: "If the update rolls back, readers repopulate the cache with stale data.",
  suggested_fix: "-  await redis.del(`project:${input.id}`);\n+  await tx.onCommit(() => redis.del(`project:${input.id}`));",
  agent_prompt: "In src/cache.ts around line 12, move the cache invalidation after the transaction commits.",
};

const result: ReviewResult = {
  walkthrough: "Adds cache invalidation after project updates and exports a VERSION constant.",
  changes: [
    { area: "Cache invalidation", files: ["src/cache.ts"], summary: "Deletes the Redis key after updating a project." },
    { area: "Docs", files: ["README.md"], summary: "Adds a README." },
  ],
  effort: 2,
  findings: [finding],
  checks: [
    { name: "Title check", status: "passed", explanation: "The title describes the change." },
    { name: "Description check", status: "warning", explanation: "The description is empty.", resolution: "Add a short description." },
  ],
  generalComments: [],
  model: "claude-opus-5-5",
  profile: "chill",
};

describe("ReviewOutputSchema", () => {
  test("rejects an unknown severity", () => {
    const bad = { ...finding, severity: "Huge" };
    expect(ReviewOutputSchema.safeParse({ walkthrough: "x", changes: [], effort: 1, findings: [bad] }).success).toBe(false);
  });
});

describe("renderSummaryComment", () => {
  const md = renderSummaryComment(result);

  test("starts with a hidden marker so the comment can be found and updated later", () => {
    expect(md.startsWith(SUMMARY_MARKER)).toBe(true);
  });

  test("contains a collapsible walkthrough with a changes table", () => {
    expect(md).toContain("<summary>📝 Walkthrough</summary>");
    expect(md).toContain("## Walkthrough");
    expect(md).toContain("|Layer / File(s)|Summary|");
    expect(md).toContain("|**Cache invalidation** <br> `src/cache.ts`|Deletes the Redis key after updating a project.|");
  });

  test("reports the review effort on the 1 to 5 scale with a label and time", () => {
    expect(md).toContain("**Estimated code review effort:** 2 (Simple) | ~10 minutes");
  });

  test("reports pre-merge checks with pass and warning counts", () => {
    expect(md).toContain("<summary>🚥 Pre-merge checks | ✅ 1 | ❌ 1</summary>");
    expect(md).toContain("| Description check | ⚠️ Warning | The description is empty. | Add a short description. |");
  });

  test("lists finding counts by severity", () => {
    expect(md).toContain("1 finding");
    expect(md).toContain("🟠 1 Major");
  });
});

describe("renderInlineComment", () => {
  const md = renderInlineComment(finding);

  test("opens with the category, severity and effort badges", () => {
    expect(md.split("\n")[0]).toBe("_🎯 Functional Correctness_ | _🟠 Major_ | _⚡ Quick win_");
  });

  test("includes the bold title, the body, a proposed fix diff and an agent prompt", () => {
    expect(md).toContain("**Cache is invalidated before the transaction commits.**");
    expect(md).toContain("If the update rolls back");
    expect(md).toContain("<summary>🐛 Proposed fix</summary>");
    expect(md).toContain("```diff\n-  await redis.del");
    expect(md).toContain("<summary>🤖 Prompt for AI Agents</summary>");
    expect(md).toContain("move the cache invalidation after the transaction commits.");
  });

  test("omits the fix section when there is no suggested fix", () => {
    const { suggested_fix: _omit, ...rest } = finding;
    expect(renderInlineComment(rest)).not.toContain("Proposed fix");
  });
});

describe("renderTerminalReport", () => {
  test("groups findings under their file with line numbers", () => {
    const text = renderTerminalReport(result);
    expect(text).toContain("src/cache.ts:12");
    expect(text).toContain("[Major]");
    expect(text).toContain("Cache is invalidated before the transaction commits.");
  });
});
