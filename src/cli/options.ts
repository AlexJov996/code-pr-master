import type { ReviewResult, Severity } from "../core/schema.js";

export interface DiffOptions {
  base?: string;
  staged?: boolean;
  working?: boolean;
}

/** argv for the git invocation that produces the diff to review. */
export function diffCommandFor(opts: DiffOptions): string[] {
  if (opts.staged) return ["git", "diff", "--staged"];
  if (opts.working) return ["git", "diff", "HEAD"];
  return ["git", "diff", `${opts.base ?? "main"}...HEAD`];
}

export type FailOn = "critical" | "major" | "minor" | "none";

const RANK: Record<Severity, number> = { Critical: 0, Major: 1, Minor: 2, Nitpick: 3 };
const THRESHOLD: Record<FailOn, number> = { critical: 0, major: 1, minor: 2, none: -1 };

/** 1 when any finding is at or above the threshold, else 0. */
export function exitCodeFor(result: ReviewResult, failOn: FailOn): 0 | 1 {
  const t = THRESHOLD[failOn];
  if (t < 0) return 0;
  const all = [...result.findings, ...result.generalComments];
  return all.some((f) => RANK[f.severity] <= t) ? 1 : 0;
}
