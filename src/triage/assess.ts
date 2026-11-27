import { z } from "zod";
import type { StructuredGenerate } from "../core/claude.js";
import type { Level, Priority, ReviewDepth } from "./score.js";
import type { TriageItem } from "./views.js";

export const TriageAiOutputSchema = z.object({
  value: z.enum(["Low", "Medium", "High"]).describe("Business or user value of landing this change soon."),
  risk: z.enum(["Low", "Medium", "High"]).describe("Risk of the change causing an incident, regression, or security issue."),
  summary: z.string().describe("One sentence, at most 20 words, on why this pull request matters and what the reviewer should focus on."),
  risk_notes: z.string().describe("Specific risk observations, or an empty string."),
});
export type TriageAiOutput = z.infer<typeof TriageAiOutputSchema>;

export const ASSESSMENT_SYSTEM = [
  "You triage open pull requests for an engineering team. You do not review code line by line.",
  "Given a pull request's title, description, changed files and a heuristic assessment, judge its value and risk,",
  "and write one sentence telling a reviewer why it matters and what to focus on. Be concrete and calm; no hype.",
].join("\n");

export function buildAssessmentPrompt(item: TriageItem, description = ""): string {
  const { signals: s, assessment: a } = item;
  return [
    `# ${s.repo} #${s.number}: ${s.title}`,
    "",
    `Author: ${s.author}${s.authorIsBot ? " (bot)" : ""} · base: ${s.baseRef} · +${s.additions}/-${s.deletions} across ${s.files.length} files · labels: ${s.labels.join(", ") || "none"}`,
    "",
    "## Description",
    description.trim() || "(none)",
    "",
    "## Changed files",
    ...s.files.slice(0, 200).map((f) => `- ${f}`),
    s.files.length > 200 ? `- … and ${s.files.length - 200} more` : "",
    "",
    "## Heuristic assessment",
    `risk ${a.risk} · blast radius ${a.blastRadius} · complexity ${a.complexity} · effort ${a.effort} · next action: ${a.nextAction}`,
  ].join("\n");
}

const LEVEL_RANK: Record<Level, number> = { Low: 0, Medium: 1, High: 2 };
const PRIORITY_RANK: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

/** Merge the model's judgment into the heuristic assessment. Risk only ever goes up; the summary becomes the why. */
export function applyAssessment(item: TriageItem, ai: TriageAiOutput): TriageItem {
  const a = { ...item.assessment, tags: [...item.assessment.tags] };
  const raised = LEVEL_RANK[ai.risk] > LEVEL_RANK[a.risk];
  if (raised) a.risk = ai.risk;
  if (!item.signals.isDraft) {
    const depth: ReviewDepth = a.risk === "High" ? "Deep review" : a.risk === "Medium" || a.complexity === "High" ? "Standard review" : "Quick review";
    a.reviewDepth = depth;
  }
  if (a.risk === "High" && PRIORITY_RANK[a.priority] > PRIORITY_RANK.P1) a.priority = "P1";
  if (ai.value === "High") {
    a.tags.push("High value");
    if (PRIORITY_RANK[a.priority] > PRIORITY_RANK.P1) a.priority = "P1";
  }
  if (ai.summary.trim()) a.why = ai.summary.trim();
  if (ai.risk_notes.trim()) a.tags.push(`Risk: ${ai.risk_notes.trim()}`);
  const base: Record<Priority, number> = { P0: 90, P1: 70, P2: 50, P3: 30 };
  a.score = Math.min(100, Math.max(a.score, base[a.priority]) + (raised ? 5 : 0) + (ai.value === "High" ? 5 : 0));
  a.priorityLabel = { P0: "Urgent", P1: "High priority", P2: "Medium priority", P3: "Low priority" }[a.priority];
  return { signals: item.signals, assessment: a };
}

export interface EnrichOptions {
  descriptions?: Map<number, string>;
  concurrency?: number;
  onError?: (item: TriageItem, err: unknown) => void;
}

/** Run the model assessment over every item, a few at a time; failures leave the heuristic assessment in place. */
export async function enrichItems(items: TriageItem[], generate: StructuredGenerate<TriageAiOutput>, opts: EnrichOptions = {}): Promise<TriageItem[]> {
  const out = [...items];
  const limit = Math.max(1, opts.concurrency ?? 4);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      const item = items[i]!;
      try {
        const ai = await generate(ASSESSMENT_SYSTEM, buildAssessmentPrompt(item, opts.descriptions?.get(item.signals.number)));
        out[i] = applyAssessment(item, ai);
      } catch (err) {
        opts.onError?.(item, err);
      }
    }
  }));
  return out;
}
