import { instructionsForPath, type Config, type Profile } from "./config.js";
import { parseUnifiedDiff, renderAnnotatedDiff, type FileDiff } from "./diff.js";

const PROFILE_GUIDANCE: Record<Profile, string> = {
  chill:
    "Profile: chill. Report defects that matter: bugs, security issues, data loss, broken behavior, " +
    "misleading code, and missing tests for risky logic. Skip pure style nitpicks unless they hide a bug.",
  assertive:
    "Profile: assertive. Be thorough. Report everything from critical defects down to style, naming, " +
    "documentation and nitpicks, as long as each item is concrete and actionable.",
  quiet:
    "Profile: quiet. Report only Critical and Major findings: bugs, security issues, data loss, " +
    "or broken behavior. Stay silent on anything else.",
};

/** Stable, cacheable system prompt. Keep volatile content out of here. */
export function buildSystemPrompt(config: Config): string {
  const parts = [
    "You are an expert code reviewer working as an automated pull request reviewer, in the spirit of CodeRabbit.",
    "You receive the pull request title, description and a unified diff annotated with new-side line numbers.",
    "",
    "Your job:",
    "1. Write a walkthrough: two to four sentences on what the change set does and why, in plain language.",
    "2. Group the changes into a few logical areas, each with the files it touches and a one or two sentence summary.",
    "3. Estimate review effort from 1 (trivial) to 5 (critical) based on size, risk and complexity.",
    "4. Report findings. Each finding is anchored to one file and one new-side line number taken from the annotated diff.",
    "   Only cite line numbers that appear in the diff with a number (added or context lines). Never cite deleted lines or lines outside the hunks.",
    "   The title is one sentence stating the defect. The body explains why it matters and what to do, in two to five sentences.",
    "   Add a suggested_fix as a small unified diff body (lines starting with - and +, no headers) when a concrete patch helps.",
    "   The agent_prompt must be self-contained: name the file, the lines and the exact change, so a coding agent can apply it.",
    "   Do not invent problems. Do not comment on code outside the diff unless the diff breaks it. Do not restate what the code does.",
    "   Prefer fewer, higher-value findings over many weak ones. Never duplicate a finding across lines.",
    "",
    "Severity: Critical (data loss, security, crash, wrong results in production), Major (likely bug or significant risk),",
    "Minor (real but low-impact issue), Nitpick (style, naming, wording).",
    "Effort: Quick win (minutes), Moderate (an hour or so), Significant (a redesign or wide change).",
    "",
    PROFILE_GUIDANCE[config.reviews.profile],
    `Write every string in the language with tag "${config.language}".`,
  ];
  if (config.tone_instructions.trim()) parts.push("", "Tone instructions from the repository:", config.tone_instructions.trim());
  return parts.join("\n");
}

export interface UserPromptInput {
  title: string;
  description: string;
  /** Parsed files; when absent, `diff` is parsed instead. */
  files?: FileDiff[];
  /** Raw unified diff text, used only when `files` is absent. */
  diff?: string;
  config: Config;
  /** Files that were in the diff but left out of the prompt (filters or size budget). */
  omitted?: string[];
}

export function buildUserPrompt(input: UserPromptInput): string {
  const parts: string[] = [
    "# Pull request",
    "",
    `**Title:** ${input.title.trim() || "(none)"}`,
    "",
    "**Description:**",
    input.description.trim() || "(none)",
    "",
  ];

  const files = input.files ?? parseUnifiedDiff(input.diff ?? "");
  const rules = files
    .map((f) => ({ path: f.path, instructions: instructionsForPath(f.path, input.config.reviews.path_instructions) }))
    .filter((r) => r.instructions.length > 0);
  if (rules.length) {
    parts.push("# Path-specific review instructions", "");
    for (const r of rules) parts.push(`- \`${r.path}\`: ${r.instructions.join(" ")}`);
    parts.push("");
  }

  if (input.omitted?.length) {
    parts.push("# Files changed but not included below", "", ...input.omitted.map((p) => `- ${p}`), "");
  }

  parts.push("# Diff (new-side line numbers on the left; `+` added, `-` removed, ` ` context)", "");
  for (const f of files) parts.push(renderAnnotatedDiff(f), "");
  return parts.join("\n");
}
