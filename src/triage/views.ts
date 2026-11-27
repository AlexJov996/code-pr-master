import { matchesGlob } from "node:path";
import type { SavedViewConfig } from "../core/config.js";
import { PRIORITY_LABEL, type Level, type NextAction, type Priority, type PullRequestSignals, type TriageAssessment } from "./score.js";

export interface TriageItem {
  signals: PullRequestSignals;
  assessment: TriageAssessment;
}

export interface ViewFilter {
  risk?: Level[];
  tags?: string[];
  labels?: string[];
  paths?: string[];
  baseBranches?: string[];
  nextAction?: NextAction[];
  authorIsBot?: boolean;
}

export interface SavedView {
  id: string;
  name: string;
  filter: ViewFilter;
}

export interface View {
  id: string;
  name: string;
  builtIn: boolean;
  filter?: ViewFilter;
  predicate?: (item: TriageItem, me: string | undefined) => boolean;
}

const eq = (a: string, b: string | undefined) => b !== undefined && a.toLowerCase() === b.toLowerCase();

export const BUILT_IN_VIEWS: View[] = [
  { id: "all", name: "All reviews", builtIn: true },
  { id: "needs-my-review", name: "Needs my review", builtIn: true, predicate: (i, me) => i.signals.requestedReviewers.some((r) => eq(r, me)) && i.assessment.nextAction !== "Safe to merge" },
  { id: "authored-by-me", name: "Authored by me", builtIn: true, predicate: (i, me) => eq(i.signals.author, me) },
  { id: "safe-to-merge", name: "Safe to merge", builtIn: true, predicate: (i) => i.assessment.nextAction === "Safe to merge" },
];

export function resolveView(id: string | undefined, saved: readonly SavedView[]): View {
  const builtIn = BUILT_IN_VIEWS.find((v) => v.id === id);
  if (builtIn) return builtIn;
  const s = saved.find((v) => v.id === id);
  if (s) return { id: s.id, name: s.name, builtIn: false, filter: s.filter };
  return BUILT_IN_VIEWS[0]!;
}

export function matchesFilter(item: TriageItem, f: ViewFilter): boolean {
  const { signals: s, assessment: a } = item;
  if (f.risk && !f.risk.includes(a.risk)) return false;
  if (f.tags && !f.tags.some((t) => a.tags.includes(t))) return false;
  if (f.labels && !f.labels.some((l) => s.labels.some((x) => eq(x, l)))) return false;
  if (f.paths && !f.paths.some((g) => s.files.some((p) => matchesGlob(p, g)))) return false;
  if (f.baseBranches && !f.baseBranches.some((g) => matchesGlob(s.baseRef, g))) return false;
  if (f.nextAction && !f.nextAction.includes(a.nextAction)) return false;
  if (f.authorIsBot !== undefined && s.authorIsBot !== f.authorIsBot) return false;
  return true;
}

export function sortItems(items: readonly TriageItem[]): TriageItem[] {
  return [...items].sort((x, y) => y.assessment.score - x.assessment.score || x.signals.number - y.signals.number);
}

export function applyView(items: readonly TriageItem[], view: View, me?: string): TriageItem[] {
  const kept = items.filter((i) => (view.predicate ? view.predicate(i, me) : true) && (view.filter ? matchesFilter(i, view.filter) : true));
  return sortItems(kept);
}

export interface PriorityGroup {
  priority: Priority;
  label: string;
  items: TriageItem[];
}

export function groupByPriority(items: readonly TriageItem[]): PriorityGroup[] {
  const groups: PriorityGroup[] = [];
  for (const priority of ["P0", "P1", "P2", "P3"] as Priority[]) {
    const bucket = sortItems(items.filter((i) => i.assessment.priority === priority));
    if (bucket.length) groups.push({ priority, label: PRIORITY_LABEL[priority], items: bucket });
  }
  return groups;
}

export function countsByView(items: readonly TriageItem[], views: readonly View[], me?: string): Record<string, number> {
  return Object.fromEntries(views.map((v) => [v.id, applyView(items, v, me).length]));
}

/** Translate the snake_case config shape into a saved view. */
export function savedViewFromConfig(v: SavedViewConfig): SavedView {
  const f = v.filter;
  const filter: ViewFilter = {};
  if (f.risk) filter.risk = f.risk;
  if (f.tags) filter.tags = f.tags;
  if (f.labels) filter.labels = f.labels;
  if (f.paths) filter.paths = f.paths;
  if (f.base_branches) filter.baseBranches = f.base_branches;
  if (f.next_action) filter.nextAction = f.next_action;
  if (f.author_is_bot !== undefined) filter.authorIsBot = f.author_is_bot;
  return { id: v.id, name: v.name, filter };
}
