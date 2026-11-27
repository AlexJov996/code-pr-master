import { describe, expect, test } from "vitest";
import { z } from "zod";
import { createStructuredGenerate } from "../../src/core/claude.js";
import { applyAssessment, buildAssessmentPrompt, TriageAiOutputSchema, type TriageAiOutput } from "../../src/triage/assess.js";
import type { TriageItem } from "../../src/triage/views.js";

const item: TriageItem = {
  signals: {
    repo: "acme/platform", number: 9, title: "feat(mcp): reverse tunnel routing", author: "casey", authorIsBot: false, isDraft: false,
    createdAt: new Date("2026-11-27T10:00:00Z"), updatedAt: new Date("2026-11-27T11:00:00Z"), baseRef: "main", additions: 200, deletions: 20,
    files: ["src/mcp/tunnel.ts"], labels: [], requestedReviewers: [], reviews: [], ciStatus: "success",
  },
  assessment: {
    priority: "P2", priorityLabel: "Medium priority", risk: "Medium", reviewDepth: "Standard review", complexity: "Medium", effort: "Medium",
    blastRadius: "Low", nextAction: "Needs human review", tags: [], why: "New, active work needs your attention.", score: 55, suggestedReviewers: [],
  },
};

describe("buildAssessmentPrompt", () => {
  test("includes title, description, file list and the heuristic assessment", () => {
    const p = buildAssessmentPrompt(item, "Adds a reverse tunnel so integrations can call back.");
    expect(p).toContain("feat(mcp): reverse tunnel routing");
    expect(p).toContain("src/mcp/tunnel.ts");
    expect(p).toContain("reverse tunnel");
    expect(p).toContain("Medium");
  });
});

describe("applyAssessment", () => {
  const ai: TriageAiOutput = { value: "High", risk: "High", summary: "Opens an inbound path from integrations into the platform.", risk_notes: "Auth on the tunnel is not shown." };

  test("raises risk and priority when the model sees more danger than the heuristics", () => {
    const out = applyAssessment(item, ai);
    expect(out.assessment.risk).toBe("High");
    expect(out.assessment.reviewDepth).toBe("Deep review");
    expect(out.assessment.priority).toBe("P1");
    expect(out.assessment.why).toBe("Opens an inbound path from integrations into the platform.");
    expect(out.assessment.tags).toContain("High value");
    expect(out.assessment.score).toBeGreaterThan(item.assessment.score);
  });

  test("never lowers heuristic risk", () => {
    const out = applyAssessment(item, { ...ai, risk: "Low" });
    expect(out.assessment.risk).toBe("Medium");
  });
});

describe("createStructuredGenerate", () => {
  test("works with any zod schema", async () => {
    const seen: any[] = [];
    const client = { messages: { parse: async (p: any) => { seen.push(p); return { stop_reason: "end_turn", parsed_output: { value: "Low", risk: "Low", summary: "s", risk_notes: "" } }; } } };
    const gen = createStructuredGenerate(client as any, { model: "claude-opus-5-5", effort: "low" }, TriageAiOutputSchema);
    const out = await gen("S", "U");
    expect(out.value).toBe("Low");
    expect(seen[0].output_config.effort).toBe("low");
    expect(z.object({ value: z.string() }).safeParse(out).success).toBe(true);
  });
});
