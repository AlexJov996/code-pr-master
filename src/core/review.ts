import { matchesPathFilters, type Config } from "./config.js";
import { commentableLines, parseUnifiedDiff, type FileDiff } from "./diff.js";
import { buildSystemPrompt, buildUserPrompt } from "./prompt.js";
import type { Check, Finding, ReviewOutput, ReviewResult, Severity } from "./schema.js";

export type Generate = (system: string, user: string) => Promise<ReviewOutput>;

export interface ReviewInput {
  title: string;
  description: string;
  diff: string;
  config: Config;
}

export interface ReviewDeps {
  generate: Generate;
  /** Soft cap on annotated diff characters sent to the model. Files past the cap are listed, not reviewed. */
  maxDiffChars?: number;
}

const DEFAULT_MAX_DIFF_CHARS = 600_000;
const SNAP_DISTANCE = 5;

const SEVERITY_RANK: Record<Severity, number> = { Critical: 0, Major: 1, Minor: 2, Nitpick: 3 };
const PROFILE_MAX_RANK: Record<Config["reviews"]["profile"], number> = { quiet: 1, chill: 2, assertive: 3 };

export function runChecks(input: Pick<ReviewInput, "title" | "description">, files: FileDiff[]): Check[] {
  const checks: Check[] = [];
  const title = input.title.trim();
  if (title.length < 8 || /^(wip|fix|update|changes?|test)$/i.test(title)) {
    checks.push({ name: "Title check", status: "warning", explanation: "The title is too short or generic to describe the change.", resolution: "Use a descriptive title, for example `fix(cache): invalidate project key after update`." });
  } else {
    checks.push({ name: "Title check", status: "passed", explanation: "The title describes the change." });
  }
  if (input.description.trim().length < 20) {
    checks.push({ name: "Description check", status: "warning", explanation: "The description is empty or too short to explain the change.", resolution: "Describe what changed, why, and how it was tested." });
  } else {
    checks.push({ name: "Description check", status: "passed", explanation: "The description explains the change." });
  }
  const total = files.reduce((n, f) => n + f.additions + f.deletions, 0);
  if (total > 1500) {
    checks.push({ name: "Size check", status: "warning", explanation: `The pull request changes ${total} lines across ${files.length} files.`, resolution: "Split it into smaller, independently reviewable pull requests." });
  } else {
    checks.push({ name: "Size check", status: "passed", explanation: `${total} changed lines across ${files.length} files is reviewable in one pass.` });
  }
  return checks;
}

function anchor(f: Finding, byPath: Map<string, Set<number>>): Finding | undefined {
  const lines = byPath.get(f.path);
  if (!lines || lines.size === 0) return undefined;
  if (lines.has(f.line)) return f;
  let best: number | undefined;
  for (const n of lines) {
    const d = Math.abs(n - f.line);
    if (d <= SNAP_DISTANCE && (best === undefined || d < Math.abs(best - f.line))) best = n;
  }
  if (best === undefined) return undefined;
  const snapped: Finding = { ...f, line: best };
  if (snapped.end_line !== undefined && snapped.end_line < best) delete snapped.end_line;
  return snapped;
}

export async function reviewChanges(input: ReviewInput, deps: ReviewDeps): Promise<ReviewResult> {
  const { config } = input;
  const all = parseUnifiedDiff(input.diff);
  const inScope = all.filter((f) => matchesPathFilters(f.path, config.reviews.path_filters));
  const checks = runChecks(input, all);
  const base = { checks, generalComments: [] as Finding[], model: config.model, profile: config.reviews.profile };

  if (inScope.length === 0) {
    return { ...base, walkthrough: "No files in scope for review after applying path filters.", changes: [], effort: 1, findings: [] };
  }

  // Size budget: keep whole files, in order, until the budget is spent.
  const max = deps.maxDiffChars ?? DEFAULT_MAX_DIFF_CHARS;
  const included: FileDiff[] = [];
  const omitted: string[] = [];
  let used = 0;
  for (const f of inScope) {
    const size = f.hunks.reduce((n, h) => n + h.lines.reduce((m, l) => m + l.content.length + 12, 0), 0);
    if (used + size > max && included.length > 0) omitted.push(f.path);
    else { included.push(f); used += size; }
  }

  const output = await deps.generate(buildSystemPrompt(config), buildUserPrompt({ ...input, files: included, omitted }));

  const byPath = new Map(included.map((f) => [f.path, commentableLines(f)]));
  const maxRank = PROFILE_MAX_RANK[config.reviews.profile];
  const findings: Finding[] = [];
  const generalComments: Finding[] = [];
  const seen = new Set<string>();
  for (const f of output.findings) {
    if (SEVERITY_RANK[f.severity] > maxRank) continue;
    const key = `${f.path}:${f.line}:${f.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const a = anchor(f, byPath);
    if (a) findings.push(a);
    else generalComments.push(f);
  }
  findings.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);

  return { ...base, walkthrough: output.walkthrough, changes: output.changes, effort: output.effort, findings, generalComments };
}
