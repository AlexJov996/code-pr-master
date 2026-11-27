import type { FileDiff } from "../core/diff.js";
import { CRITICAL_PATH, SENSITIVE_PATH, type Level } from "../triage/score.js";
import type { ChangeStack, ChangeStackOutput, Layer, RegionSummary } from "./schema.js";

interface Category { title: string; description: string; test: (p: string) => boolean; code: boolean }

const CATEGORIES: Category[] = [
  { title: "Tests", description: "Automated tests covering the change.", test: (p) => /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.(go|py)$|test_.*\.py$/i.test(p), code: false },
  { title: "Documentation", description: "Docs and prose.", test: (p) => /(^|\/)docs?\/|\.(md|mdx|rst|txt|adoc)$/i.test(p), code: false },
  { title: "Configuration and build", description: "Configuration, dependencies and build setup.", test: (p) => /(^|\/)(package\.json|pnpm-lock\.yaml|yarn\.lock|package-lock\.json|Dockerfile|docker-compose\.ya?ml|\.github\/|tsconfig[^/]*\.json|\.env[^/]*|Makefile|.*\.toml|.*\.ini)$/i.test(p), code: false },
  { title: "Data model", description: "Schema, migrations and persistence.", test: (p) => /(^|\/)(prisma|migrations?|models?|schema|db|database)(\/|\.)|\.(prisma|sql)$/i.test(p), code: true },
  { title: "User interface", description: "Screens, components and styles.", test: (p) => /(^|\/)(web|ui|client|frontend|components?|pages|views|app)\/|\.(tsx|jsx|vue|svelte|css|scss|html)$/i.test(p), code: true },
  { title: "Server and API", description: "Server-side logic, services and endpoints.", test: () => true, code: true },
];
const DISPLAY_ORDER = ["Data model", "Server and API", "User interface", "Configuration and build", "Tests", "Documentation"];

/** Group files into conventional layers by path when no model output is available. */
export function heuristicLayers(files: readonly FileDiff[]): Layer[] {
  const buckets = new Map<string, string[]>();
  for (const f of files) {
    const cat = CATEGORIES.find((c) => c.test(f.path))!;
    buckets.set(cat.title, [...(buckets.get(cat.title) ?? []), f.path]);
  }
  const layers: Layer[] = [];
  let lastCode: number | undefined;
  for (const title of DISPLAY_ORDER) {
    const paths = buckets.get(title);
    if (!paths?.length) continue;
    const cat = CATEGORIES.find((c) => c.title === title)!;
    const dependsOn = lastCode !== undefined && (cat.code || title === "Tests") ? [lastCode] : [];
    layers.push({ title, description: cat.description, files: paths, dependsOn, risks: [] });
    if (cat.code) lastCode = layers.length - 1;
  }
  return layers;
}

/** Topological order that respects dependsOn, stable on the input order; a cycle falls back to the input order. */
export function orderLayers(layers: readonly Layer[]): Layer[] {
  const n = layers.length;
  const placed: number[] = [];
  const done = new Set<number>();
  let progress = true;
  while (placed.length < n && progress) {
    progress = false;
    for (let i = 0; i < n; i++) {
      if (done.has(i)) continue;
      if (layers[i]!.dependsOn.every((d) => done.has(d) || d < 0 || d >= n)) { placed.push(i); done.add(i); progress = true; }
    }
  }
  if (placed.length < n) return layers.map((l) => ({ ...l }));
  const remap = new Map(placed.map((old, idx) => [old, idx]));
  return placed.map((old) => ({ ...layers[old]!, dependsOn: layers[old]!.dependsOn.filter((d) => remap.has(d)).map((d) => remap.get(d)!).sort((a, b) => a - b) }));
}

/** Turn raw model output into a consistent stack: real files only, every file in one layer, valid dependencies, in-range summaries. */
export function normalizeStack(output: ChangeStackOutput, files: readonly FileDiff[]): ChangeStack {
  const known = new Map(files.map((f) => [f.path, f]));
  const titleIndex = new Map(output.layers.map((l, i) => [l.title.trim().toLowerCase(), i]));
  const assigned = new Set<string>();
  const layers: Layer[] = output.layers.map((l, i) => {
    const paths = l.files.filter((p) => known.has(p) && !assigned.has(p));
    for (const p of paths) assigned.add(p);
    const dependsOn = [...new Set(l.depends_on.map((t) => titleIndex.get(t.trim().toLowerCase())).filter((d): d is number => d !== undefined && d !== i))];
    return { title: l.title.trim(), description: l.description.trim(), files: paths, dependsOn, risks: l.risks.map((r) => r.trim()).filter(Boolean) };
  });
  const ordered = orderLayers(layers).filter((l) => l.files.length > 0 || l.risks.length > 0);
  const leftover = files.map((f) => f.path).filter((p) => !assigned.has(p));
  if (leftover.length) ordered.push({ title: "Other changes", description: "Files the walkthrough did not place in a layer.", files: leftover, dependsOn: [], risks: [] });

  const summaries: RegionSummary[] = [];
  for (const s of output.summaries) {
    const f = known.get(s.path);
    if (!f) continue;
    const maxLine = f.hunks.reduce((m, h) => Math.max(m, h.newStart + h.newLines - 1), 0);
    if (s.start_line < 1 || s.end_line < s.start_line || s.end_line > maxLine) continue;
    summaries.push({ path: s.path, startLine: s.start_line, endLine: s.end_line, lines: s.end_line - s.start_line + 1, symbol: s.symbol?.trim() || undefined, complexity: s.complexity, summary: s.summary.trim() });
  }

  return { title: output.title.trim(), summary: output.summary.trim(), layers: ordered, summaries, architecture: output.architecture, source: "model" };
}

export interface LayerStats {
  files: number;
  additions: number;
  deletions: number;
  areas: string[];
  blastRadius: Level;
  securitySensitive: string[];
}

export function layerStats(layer: Layer, files: readonly FileDiff[]): LayerStats {
  const mine = layer.files.map((p) => files.find((f) => f.path === p)).filter((f): f is FileDiff => Boolean(f));
  const areas = [...new Set(mine.map((f) => (f.path.includes("/") ? f.path.split("/")[0]! : "(root)")))].sort();
  const shared = mine.some((f) => /(^|\/)(packages\/core|core|shared|lib|common|platform|sdk)(\/|$)/i.test(f.path));
  const blastRadius: Level = areas.length >= 3 || shared || mine.length >= 15 ? "High" : areas.length === 2 || mine.length >= 6 ? "Medium" : "Low";
  return {
    files: mine.length,
    additions: mine.reduce((n, f) => n + f.additions, 0),
    deletions: mine.reduce((n, f) => n + f.deletions, 0),
    areas,
    blastRadius,
    securitySensitive: mine.filter((f) => CRITICAL_PATH.test(f.path) || SENSITIVE_PATH.test(f.path)).map((f) => f.path),
  };
}
