import { z } from "zod";
import type { Profile } from "./config.js";

export const CATEGORIES = [
  "Functional Correctness",
  "Security",
  "Performance",
  "Maintainability & Code Quality",
  "Testing",
  "Documentation",
] as const;
export const SEVERITIES = ["Critical", "Major", "Minor", "Nitpick"] as const;
export const EFFORTS = ["Quick win", "Moderate", "Significant"] as const;

export type Category = (typeof CATEGORIES)[number];
export type Severity = (typeof SEVERITIES)[number];
export type Effort = (typeof EFFORTS)[number];

export const FindingSchema = z.object({
  path: z.string().describe("Repository-relative path of the file the finding is in."),
  line: z.number().int().positive().describe("New-side line number the comment anchors to, taken from the annotated diff."),
  end_line: z.number().int().positive().optional().describe("Optional last line when the finding spans a range (must be >= line)."),
  category: z.enum(CATEGORIES),
  severity: z.enum(SEVERITIES),
  effort: z.enum(EFFORTS),
  title: z.string().min(1).describe("One sentence stating the defect, ending with a period."),
  body: z.string().min(1).describe("Why it is a problem and what to do instead. Markdown, two to five sentences."),
  suggested_fix: z.string().optional().describe("Unified diff body (lines starting with - and +) for the fix, without headers. Omit when a diff would not help."),
  agent_prompt: z.string().min(1).describe("Self-contained instruction a coding agent can act on: file, lines, what to change."),
});

export const ChangeSchema = z.object({
  area: z.string().min(1).describe("Short name for a logical group of changes."),
  files: z.array(z.string()).describe("Paths or globs covered by this group."),
  summary: z.string().min(1).describe("One or two sentences describing what changed in this group."),
});

/** What the model returns; everything else on ReviewResult is computed locally. */
export const ReviewOutputSchema = z.object({
  walkthrough: z.string().min(1).describe("Two to four sentences describing the whole change set."),
  changes: z.array(ChangeSchema),
  effort: z.number().int().min(1).max(5).describe("Review effort on a 1 (trivial) to 5 (critical) scale."),
  findings: z.array(FindingSchema),
});

export type Finding = z.infer<typeof FindingSchema>;
export type Change = z.infer<typeof ChangeSchema>;
export type ReviewOutput = z.infer<typeof ReviewOutputSchema>;

export interface Check {
  name: string;
  status: "passed" | "warning" | "failed";
  explanation: string;
  resolution?: string;
}

export interface ReviewResult extends ReviewOutput {
  checks: Check[];
  /** Findings that could not be anchored to a diff line; rendered in the summary instead. */
  generalComments: Finding[];
  model: string;
  profile: Profile;
}
