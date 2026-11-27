import { z } from "zod";

export const ACTIONS = ["goto", "click", "fill", "press", "select", "check", "expect_text", "expect_not_text", "expect_url", "expect_visible", "expect_no_errors", "wait"] as const;
export type Action = (typeof ACTIONS)[number];

export const TargetSchema = z.object({
  role: z.string().optional().describe("ARIA role, e.g. button, link, textbox."),
  name: z.string().optional().describe("Accessible name used with role."),
  text: z.string().optional().describe("Visible text of the element."),
  label: z.string().optional().describe("Form label or aria-label."),
  placeholder: z.string().optional(),
  testId: z.string().optional(),
  selector: z.string().optional().describe("CSS selector, last resort."),
});
export type Target = z.infer<typeof TargetSchema>;

export const StepSchema = z.object({
  action: z.enum(ACTIONS),
  target: TargetSchema.optional(),
  value: z.string().optional().describe("Text to type, option to select, expected text or URL, key to press, or milliseconds to wait."),
  url: z.string().optional().describe("Relative URL for goto."),
});
export type Step = z.infer<typeof StepSchema>;

export const JourneySchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "id must be a lowercase slug"),
  title: z.string().min(1),
  goal: z.string().min(1).describe("What the user is trying to achieve."),
  expected: z.string().optional().describe("The outcome that proves the goal was met."),
  steps: z.array(StepSchema).min(1),
  source: z.enum(["generated", "saved"]).default("saved"),
  tags: z.array(z.string()).optional(),
});
export type Journey = z.infer<typeof JourneySchema>;

/** What the model returns when generating scenarios. */
export const JourneysOutputSchema = z.object({
  journeys: z.array(JourneySchema.omit({ source: true, tags: true })),
});
export type JourneysOutput = z.infer<typeof JourneysOutputSchema>;

export const FindingOutputSchema = z.object({
  title: z.string().min(1).describe("One line naming the bug from the user's point of view."),
  expected: z.string().min(1),
  observed: z.string().min(1),
  guidance: z.string().min(1).describe("Developer guidance: where to look and what to keep consistent."),
});
export type FindingOutput = z.infer<typeof FindingOutputSchema>;

export interface LogEntry { ts: number; level: string; text: string }
export interface NetEntry { ts: number; method: string; url: string; status?: number; failed?: boolean }

export interface StepResult {
  index: number;
  step: Step;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  url?: string;
  error?: string;
  screenshot?: string;
}

export interface Finding {
  title: string;
  expected: string;
  observed: string;
  guidance: string;
  stepIndex: number;
}

export interface JourneyRun {
  journey: Journey;
  status: "passed" | "failed" | "blocked";
  startedAt: string;
  durationMs: number;
  steps: StepResult[];
  evidence: { screenshots: string[]; recording?: string; logs: LogEntry[]; network: NetEntry[] };
  finding?: Finding;
}

export interface VerifyRun {
  id: string;
  baseUrl: string;
  revision?: string;
  environment: { browser: string; viewport: string; headless: boolean };
  startedAt: string;
  finishedAt: string;
  runs: JourneyRun[];
  summary: { passed: number; failed: number; blocked: number };
  /** Directory holding the evidence files; paths inside runs are relative to it. */
  dir?: string;
}
