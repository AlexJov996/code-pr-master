import { matchesGlob } from "node:path";

export interface CodeownersRule {
  pattern: string;
  owners: string[];
}

export function parseCodeowners(text: string): CodeownersRule[] {
  const rules: CodeownersRule[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/(^|\s)#.*$/, "").trim();
    if (!line) continue;
    const [pattern, ...owners] = line.split(/\s+/);
    if (pattern && owners.length) rules.push({ pattern, owners });
  }
  return rules;
}

/** Translate a CODEOWNERS pattern into the glob(s) that implement GitHub's matching rules. */
function globsFor(pattern: string): string[] {
  let p = pattern;
  const anchored = p.startsWith("/");
  if (anchored) p = p.slice(1);
  const dir = p.endsWith("/");
  if (dir) p = p.slice(0, -1);
  const hasSlash = p.includes("/");
  const base = anchored || hasSlash ? p : `**/${p}`;
  return dir ? [`${base}/**`] : [base, `${base}/**`];
}

export function ownersFor(path: string, rules: readonly CodeownersRule[]): string[] {
  let owners: string[] = [];
  for (const r of rules) if (globsFor(r.pattern).some((g) => matchesGlob(path, g))) owners = r.owners;
  return owners;
}

export interface SuggestOptions {
  exclude?: string[];
  limit?: number;
}

/** Owners ranked by how many of the changed files they own; handles are returned without the leading @. */
export function suggestReviewers(files: readonly string[], rules: readonly CodeownersRule[], opts: SuggestOptions = {}): string[] {
  const exclude = new Set((opts.exclude ?? []).map((e) => e.replace(/^@/, "").toLowerCase()));
  const counts = new Map<string, number>();
  for (const f of files) {
    for (const o of ownersFor(f, rules)) {
      const handle = o.replace(/^@/, "");
      if (exclude.has(handle.toLowerCase())) continue;
      counts.set(handle, (counts.get(handle) ?? 0) + 1);
    }
  }
  const order = [...counts.keys()];
  return order.sort((a, b) => counts.get(b)! - counts.get(a)! || order.indexOf(a) - order.indexOf(b)).slice(0, opts.limit ?? 3);
}
