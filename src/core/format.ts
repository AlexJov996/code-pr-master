import type { Check, Finding, ReviewResult, Severity } from "./schema.js";

export const BOT_NAME = "carrot-review";
export const SUMMARY_MARKER = "<!-- carrot-review:summary -->";

const SEVERITY_ICON: Record<Severity, string> = { Critical: "🔴", Major: "🟠", Minor: "🟡", Nitpick: "🧹" };
const CATEGORY_ICON: Record<string, string> = {
  "Functional Correctness": "🎯",
  Security: "🔒",
  Performance: "🚀",
  "Maintainability & Code Quality": "📐",
  Testing: "🧪",
  Documentation: "📚",
};
const EFFORT_ICON: Record<string, string> = { "Quick win": "⚡", Moderate: "🔧", Significant: "🏗️" };
const FIX_ICON: Record<string, string> = { Security: "🛡️", Performance: "🚀", Testing: "🧪", Documentation: "📝" };

const EFFORT_LABEL: Record<number, string> = {
  1: "Trivial", 2: "Simple", 3: "Moderate", 4: "Complex", 5: "Critical",
};
const EFFORT_TIME: Record<number, string> = {
  1: "~5 minutes", 2: "~10 minutes", 3: "~25 minutes", 4: "~50 minutes", 5: "~90+ minutes",
};

function checkRow(c: Check, withResolution: boolean): string {
  const status = c.status === "passed" ? "✅ Passed" : c.status === "warning" ? "⚠️ Warning" : "❌ Failed";
  return withResolution
    ? `| ${c.name} | ${status} | ${c.explanation} | ${c.resolution ?? ""} |`
    : `| ${c.name} | ${status} | ${c.explanation} |`;
}

export function severityCounts(findings: readonly Finding[]): Partial<Record<Severity, number>> {
  const out: Partial<Record<Severity, number>> = {};
  for (const f of findings) out[f.severity] = (out[f.severity] ?? 0) + 1;
  return out;
}

/** The sticky summary comment posted once per pull request and updated on later pushes. */
export function renderSummaryComment(r: ReviewResult): string {
  const lines: string[] = [SUMMARY_MARKER, ""];

  lines.push("<details>", "<summary>📝 Walkthrough</summary>", "", "## Walkthrough", "", r.walkthrough, "", "### Changes", "");
  lines.push("|Layer / File(s)|Summary|", "|---|---|");
  for (const c of r.changes) {
    const files = c.files.map((f) => `\`${f}\``).join(", ");
    lines.push(`|**${c.area}** <br> ${files}|${c.summary}|`);
  }
  lines.push("", `**Estimated code review effort:** ${r.effort} (${EFFORT_LABEL[r.effort] ?? "Unknown"}) | ${EFFORT_TIME[r.effort] ?? ""}`, "", "</details>", "");

  const failed = r.checks.filter((c) => c.status !== "passed");
  const passed = r.checks.filter((c) => c.status === "passed");
  lines.push("<details>", `<summary>🚥 Pre-merge checks | ✅ ${passed.length} | ❌ ${failed.length}</summary>`, "");
  if (failed.length) {
    lines.push(`### ❌ Failed checks (${failed.length})`, "", "| Check name | Status | Explanation | Resolution |", "| :---: | :--- | :--- | :--- |");
    for (const c of failed) lines.push(checkRow(c, true));
    lines.push("");
  }
  if (passed.length) {
    lines.push("<details>", `<summary>✅ Passed checks (${passed.length} passed)</summary>`, "", "| Check name | Status | Explanation |", "| :---: | :--- | :--- |");
    for (const c of passed) lines.push(checkRow(c, false));
    lines.push("", "</details>");
  }
  lines.push("", "</details>", "");

  const all = [...r.findings, ...r.generalComments];
  const counts = severityCounts(all);
  const badges = (Object.keys(SEVERITY_ICON) as Severity[])
    .filter((s) => counts[s])
    .map((s) => `${SEVERITY_ICON[s]} ${counts[s]} ${s}`)
    .join(" · ");
  lines.push(`**Review:** ${all.length} finding${all.length === 1 ? "" : "s"}${badges ? ` (${badges})` : ""} · profile \`${r.profile}\` · model \`${r.model}\``);

  if (r.generalComments.length) {
    lines.push("", "<details>", `<summary>💬 Additional comments (${r.generalComments.length})</summary>`, "");
    for (const f of r.generalComments) {
      lines.push(`#### \`${f.path}\` line ${f.line}`, "", renderInlineComment(f), "");
    }
    lines.push("</details>");
  }

  lines.push("", "---", "", `<sub>Comment \`@${BOT_NAME} help\` to get the list of available commands.</sub>`);
  return lines.join("\n");
}

/** One review comment anchored to a diff line. */
export function renderInlineComment(f: Finding): string {
  const header = `_${CATEGORY_ICON[f.category] ?? "💡"} ${f.category}_ | _${SEVERITY_ICON[f.severity]} ${f.severity}_ | _${EFFORT_ICON[f.effort] ?? "🔧"} ${f.effort}_`;
  const lines = [header, "", `**${f.title}**`, "", f.body.trim()];
  if (f.suggested_fix && f.suggested_fix.trim()) {
    lines.push("", "<details>", `<summary>${FIX_ICON[f.category] ?? "🐛"} Proposed fix</summary>`, "", "```diff", f.suggested_fix.trim(), "```", "", "</details>");
  }
  lines.push("", "<details>", "<summary>🤖 Prompt for AI Agents</summary>", "", "```", "Verify each finding against current code. Fix only still-valid issues, skip the", "rest with a brief reason, keep changes minimal, and validate.", "", f.agent_prompt.trim(), "```", "", "</details>");
  return lines.join("\n");
}

/** Plain report for the terminal / CLI. */
export function renderTerminalReport(r: ReviewResult): string {
  const lines: string[] = ["# Review", "", r.walkthrough, ""];
  if (r.changes.length) {
    lines.push("## Changes", "");
    for (const c of r.changes) lines.push(`- **${c.area}** (${c.files.join(", ")}): ${c.summary}`);
    lines.push("");
  }
  lines.push(`Estimated review effort: ${r.effort}/5 (${EFFORT_LABEL[r.effort] ?? ""}, ${EFFORT_TIME[r.effort] ?? ""})`, "");
  if (r.checks.length) {
    lines.push("## Pre-merge checks", "");
    for (const c of r.checks) lines.push(`- ${c.status === "passed" ? "✅" : c.status === "warning" ? "⚠️" : "❌"} ${c.name}: ${c.explanation}${c.resolution ? ` → ${c.resolution}` : ""}`);
    lines.push("");
  }
  const all = [...r.findings, ...r.generalComments];
  lines.push(`## Findings (${all.length})`, "");
  if (!all.length) lines.push("No issues found.", "");
  const byFile = new Map<string, Finding[]>();
  for (const f of all) byFile.set(f.path, [...(byFile.get(f.path) ?? []), f]);
  for (const [path, fs] of byFile) {
    lines.push(`### ${path}`, "");
    for (const f of fs.sort((a, b) => a.line - b.line)) {
      lines.push(`#### ${path}:${f.line} [${f.severity}] ${f.title}`, "", `_${f.category} · ${f.effort}_`, "", f.body.trim(), "");
      if (f.suggested_fix?.trim()) lines.push("```diff", f.suggested_fix.trim(), "```", "");
    }
  }
  return lines.join("\n");
}
