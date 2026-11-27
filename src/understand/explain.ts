import type { StructuredGenerate } from "../core/claude.js";
import { parseUnifiedDiff, renderAnnotatedDiff, type FileDiff } from "../core/diff.js";
import type { Level } from "../triage/score.js";
import { heuristicLayers, layerStats, normalizeStack, type LayerStats } from "./layers.js";
import type { ArchitectureEdge, ChangeStack, ChangeStackOutput, Complexity, RegionSummary } from "./schema.js";
import { semanticChangesForDiff, type SemanticChange } from "./semantic.js";

export interface ExplainInput {
  title: string;
  description: string;
  diff: string;
}

export interface ExplainDeps {
  /** Structured call returning a ChangeStackOutput; omit for the heuristic walkthrough. */
  generate?: StructuredGenerate<ChangeStackOutput>;
  maxDiffChars?: number;
}

export interface Overview {
  files: number;
  additions: number;
  deletions: number;
  areas: string[];
  blastRadius: Level;
  securitySensitive: string[];
  /** Things a reviewer should look at before approving. */
  attention: string[];
}

export interface ExplainResult {
  stack: ChangeStack;
  files: FileDiff[];
  semantic: Record<string, SemanticChange[]>;
  layerStats: LayerStats[];
  overview: Overview;
}

export const EXPLAIN_SYSTEM = [
  "You explain large code changes to reviewers. You receive a pull request title, description, the symbols that changed, and a diff annotated with new-side line numbers.",
  "",
  "Produce a change stack:",
  "1. Split the change into 2 to 6 ordered layers, each a logical step (data model, service, API, UI, tests...). Every file in the diff goes in exactly one layer. Give each layer an imperative title, a one or two sentence description, the titles of layers it depends on, and concrete risks if any.",
  "2. Summarize the regions a reviewer must understand: functions or blocks with real logic. Cite exact new-side line ranges from the annotated diff. Rate complexity High for branching, state, concurrency or security logic; Low for plumbing.",
  "3. Describe the architecture as edges between the components the change touches (component names, not sentences), enough to draw a small diagram.",
  "",
  "Be specific and factual. Do not pad. Use the file paths exactly as given.",
].join("\n");

export function buildExplainUserPrompt(input: ExplainInput, opts: { files?: FileDiff[]; omitted?: string[] } = {}): string {
  const files = opts.files ?? parseUnifiedDiff(input.diff);
  const semantic = semanticChangesForDiff(files);
  const parts = [`# ${input.title.trim() || "(untitled)"}`, "", input.description.trim() || "(no description)", ""];
  const entries = Object.entries(semantic);
  if (entries.length) {
    parts.push("## Symbols changed", "");
    for (const [path, changes] of entries) parts.push(`- \`${path}\`: ${changes.filter((c) => c.symbolKind !== "import").map((c) => `${c.kind} ${c.symbolKind} ${c.symbol} (line ${c.line})`).join(", ") || "imports only"}`);
    parts.push("");
  }
  if (opts.omitted?.length) parts.push("## Files changed but not included below", "", ...opts.omitted.map((p) => `- ${p}`), "");
  parts.push("## Diff (new-side line numbers on the left)", "");
  for (const f of files) parts.push(renderAnnotatedDiff(f), "");
  return parts.join("\n");
}

const EXT_CANDIDATES = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", "/index.ts", "/index.tsx", "/index.js"];

function resolveRelative(from: string, spec: string): string {
  const parts = from.split("/").slice(0, -1);
  for (const seg of spec.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

/** Edges from files to the files they import, restricted to files present in the diff. */
export function importEdges(files: readonly FileDiff[], semantic: Record<string, SemanticChange[]>): ArchitectureEdge[] {
  const paths = new Set(files.map((f) => f.path));
  const edges: ArchitectureEdge[] = [];
  const seen = new Set<string>();
  for (const [from, changes] of Object.entries(semantic)) {
    for (const c of changes) {
      if (c.symbolKind !== "import" || !c.symbol.startsWith(".")) continue;
      const base = resolveRelative(from, c.symbol);
      const to = EXT_CANDIDATES.map((e) => base + e).find((p) => paths.has(p));
      if (!to || to === from || seen.has(`${from}>${to}`)) continue;
      seen.add(`${from}>${to}`);
      edges.push({ from, to, label: "imports" });
    }
  }
  return edges;
}

function complexityForLines(n: number): Complexity {
  return n > 25 ? "High" : n > 10 ? "Medium" : "Low";
}

/** Region summaries derived from declarations when no model output exists. */
export function heuristicSummaries(files: readonly FileDiff[], semantic: Record<string, SemanticChange[]>): RegionSummary[] {
  const out: RegionSummary[] = [];
  for (const f of files) {
    const changes = (semantic[f.path] ?? []).filter((c) => c.symbolKind !== "import" && c.symbolKind !== "const" && c.kind !== "removed");
    if (!changes.length) continue;
    const content = new Map<number, string>();
    for (const h of f.hunks) for (const l of h.lines) if (l.newLine !== undefined) content.set(l.newLine, l.content);
    const maxLine = Math.max(...content.keys());
    const decls = [...changes].sort((a, b) => a.line - b.line);
    decls.forEach((c, i) => {
      let end = (decls[i + 1]?.line ?? maxLine + 1) - 1;
      while (end > c.line && (content.get(end) ?? "").trim() === "") end--;
      const lines = end - c.line + 1;
      const verb = c.kind === "added" ? "Adds" : "Changes";
      out.push({ path: f.path, startLine: c.line, endLine: end, lines, symbol: c.symbol, complexity: complexityForLines(lines), summary: `${verb} ${c.symbolKind} \`${c.symbol}\` (${lines} line${lines === 1 ? "" : "s"}).` });
    });
  }
  const rank: Record<Complexity, number> = { High: 0, Medium: 1, Low: 2 };
  return out.sort((a, b) => rank[a.complexity] - rank[b.complexity] || b.lines - a.lines);
}

function heuristicStack(input: ExplainInput, files: FileDiff[], semantic: Record<string, SemanticChange[]>): ChangeStack {
  const layers = heuristicLayers(files);
  const areas = [...new Set(files.map((f) => (f.path.includes("/") ? f.path.split("/")[0]! : "(root)")))];
  const summary = `${files.length} file${files.length === 1 ? "" : "s"} changed across ${areas.length} area${areas.length === 1 ? "" : "s"} (${areas.join(", ")}), grouped into ${layers.length} layer${layers.length === 1 ? "" : "s"}: ${layers.map((l) => l.title.toLowerCase()).join(", ")}.`;
  return { title: input.title.trim() || "Untitled change", summary, layers, summaries: heuristicSummaries(files, semantic), architecture: importEdges(files, semantic), source: "heuristic" };
}

const DEFAULT_MAX_DIFF_CHARS = 600_000;

export async function explainChanges(input: ExplainInput, deps: ExplainDeps): Promise<ExplainResult> {
  const files = parseUnifiedDiff(input.diff);
  const semantic = semanticChangesForDiff(files);

  let stack: ChangeStack;
  if (deps.generate && files.length) {
    const max = deps.maxDiffChars ?? DEFAULT_MAX_DIFF_CHARS;
    const included: FileDiff[] = [];
    const omitted: string[] = [];
    let used = 0;
    for (const f of files) {
      const size = f.hunks.reduce((n, h) => n + h.lines.reduce((m, l) => m + l.content.length + 12, 0), 0);
      if (used + size > max && included.length) omitted.push(f.path);
      else { included.push(f); used += size; }
    }
    const output = await deps.generate(EXPLAIN_SYSTEM, buildExplainUserPrompt(input, { files: included, omitted }));
    stack = normalizeStack(output, files);
    if (!stack.architecture.length) stack.architecture = importEdges(files, semantic);
    if (!stack.summaries.length) stack.summaries = heuristicSummaries(files, semantic);
  } else {
    stack = heuristicStack(input, files, semantic);
  }

  const stats = stack.layers.map((l) => layerStats(l, files));
  const all = layerStats({ title: "all", description: "", files: files.map((f) => f.path), dependsOn: [], risks: [] }, files);
  const attention: string[] = [];
  if (all.securitySensitive.length) attention.push(`Touches security-sensitive code: ${all.securitySensitive.join(", ")}.`);
  for (const l of stack.layers) attention.push(...l.risks);
  if (all.blastRadius === "High") attention.push(`High blast radius: ${all.files} files across ${all.areas.join(", ")}.`);
  const overview: Overview = { files: all.files, additions: all.additions, deletions: all.deletions, areas: all.areas, blastRadius: all.blastRadius, securitySensitive: all.securitySensitive, attention };
  return { stack, files, semantic, layerStats: stats, overview };
}
