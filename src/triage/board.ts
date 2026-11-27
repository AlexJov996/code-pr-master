import type { Level, Priority } from "./score.js";
import { groupByPriority, type PriorityGroup, type SavedView, type TriageItem, type View } from "./views.js";

export interface BoardInput {
  repo: string;
  me?: string;
  items: TriageItem[];
  view: View;
  views: readonly View[];
  savedViews: readonly SavedView[];
  counts: Record<string, number>;
  generatedAt: Date;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const e = escapeHtml;

const LEVEL_CLASS: Record<Level, string> = { Low: "lvl-low", Medium: "lvl-med", High: "lvl-high" };
const PRIORITY_CLASS: Record<Priority, string> = { P0: "p0", P1: "p1", P2: "p2", P3: "p3" };

function badge(text: string, cls = ""): string {
  return `<span class="badge ${cls}">${e(text)}</span>`;
}

function link(repo: string, viewId: string): string {
  return `?repo=${encodeURIComponent(repo)}&amp;view=${encodeURIComponent(viewId)}`;
}

function tab(repo: string, v: { id: string; name: string }, active: boolean, count: number | undefined): string {
  return `<a class="tab${active ? " active" : ""}" href="${link(repo, v.id)}"><span>${e(v.name)}</span> <span class="count">${count ?? 0}</span></a>`;
}

export function renderCard(item: TriageItem): string {
  const { signals: s, assessment: a } = item;
  const repoShort = s.repo.split("/")[1] ?? s.repo;
  const badges: string[] = [badge(a.priority, `prio ${PRIORITY_CLASS[a.priority]}`)];
  for (const t of a.tags) badges.push(badge(t, t === "Agent-created" ? "tag-agent" : t.startsWith("Risk:") ? "tag-risk" : "tag"));
  badges.push(badge(a.nextAction, a.nextAction === "Safe to merge" ? "action-safe" : a.nextAction === "Needs author action" ? "action-author" : "action-human"));
  badges.push(badge(`${a.risk} risk`, LEVEL_CLASS[a.risk]));
  badges.push(badge(a.reviewDepth, a.reviewDepth === "Deep review" ? "depth-deep" : "depth"));
  if (a.blastRadius !== "Low") badges.push(badge(`${a.blastRadius} blast radius`, LEVEL_CLASS[a.blastRadius]));
  badges.push(badge(`${a.complexity} complexity`, "muted"), badge(`${a.effort} effort`, "muted"));
  const author = s.authorName ? `@${s.author} (${s.authorName})` : `@${s.author}`;
  const suggest = a.suggestedReviewers.length ? `<span class="suggest">Suggested: ${a.suggestedReviewers.map((r) => `@${e(r)}`).join(", ")}</span>` : "";
  const title = s.url ? `<a class="title" href="${e(s.url)}" target="_blank" rel="noopener">${e(s.title)}</a>` : `<span class="title">${e(s.title)}</span>`;
  return [
    `<article class="card" data-score="${a.score}">`,
    `<div class="card-head"><span class="num">#${s.number}</span> <span class="repo">${e(repoShort)}</span> ${title}</div>`,
    `<p class="why">${e(a.why)}</p>`,
    `<div class="badges">${badges.join(" ")}</div>`,
    `<div class="card-foot"><span class="author">${e(author)}</span> ${suggest} <span class="meta">+${s.additions}/−${s.deletions} · ${s.files.length} file${s.files.length === 1 ? "" : "s"} · score ${a.score}</span></div>`,
    `</article>`,
  ].join("\n");
}

function renderGroup(g: PriorityGroup): string {
  return [
    `<section class="group">`,
    `<h2><span class="prio ${PRIORITY_CLASS[g.priority]}">${g.priority}</span> <span class="group-label">${e(g.label)}</span> <span class="count">${g.items.length}</span></h2>`,
    ...g.items.map(renderCard),
    `</section>`,
  ].join("\n");
}

const CSS = `
:root{--bg:#0b0d12;--panel:#12151d;--card:#171b26;--line:#232838;--text:#e6e8ee;--muted:#8b93a7;--accent:#ff7a1a;--green:#2fbf71;--red:#ff5d5d;--amber:#f2b134;--blue:#5b9cff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
a{color:inherit;text-decoration:none}
.layout{display:grid;grid-template-columns:240px 1fr;min-height:100vh}
nav{background:var(--panel);border-right:1px solid var(--line);padding:16px}
nav .brand{display:flex;align-items:center;gap:8px;font-weight:700;margin-bottom:18px}nav .brand i{width:10px;height:10px;border-radius:50%;background:var(--accent);display:inline-block}
nav h3{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:16px 0 6px}
.tab{display:flex;justify-content:space-between;padding:7px 10px;border-radius:8px;color:var(--muted)}.tab:hover{background:var(--card);color:var(--text)}.tab.active{background:var(--card);color:var(--text);box-shadow:inset 2px 0 0 var(--accent)}
.count{background:var(--line);border-radius:999px;padding:0 8px;font-size:12px;color:var(--text)}
main{padding:20px 28px;max-width:1200px}
header{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-bottom:16px}header h1{font-size:18px;margin:0}header .sub{color:var(--muted);font-size:12px}
.group{margin:18px 0 26px}.group h2{font-size:14px;display:flex;align-items:center;gap:8px;margin:0 0 10px;color:var(--muted)}
.prio{font-weight:700;padding:1px 7px;border-radius:6px;font-size:12px}.p0{background:#4a1515;color:#ff8a8a}.p1{background:#4a3315;color:#ffc46b}.p2{background:#15304a;color:#8ec1ff}.p3{background:#1d2230;color:var(--muted)}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin-bottom:10px}
.card-head{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}.num{color:var(--muted)}.repo{font-size:12px;color:var(--muted);background:var(--line);padding:0 6px;border-radius:5px}.title{font-weight:600}.title:hover{color:var(--accent)}
.why{margin:6px 0 8px;color:var(--muted)}
.badges{display:flex;flex-wrap:wrap;gap:6px}.badge{font-size:11.5px;padding:2px 8px;border-radius:999px;border:1px solid var(--line);color:var(--text)}
.badge.prio{border-color:transparent}.lvl-low{color:#9fd3b4;border-color:#1f4a33}.lvl-med{color:#ffd18a;border-color:#5a4216}.lvl-high{color:#ff9d9d;border-color:#5a1f1f}
.action-safe{color:var(--green);border-color:#1f4a33}.action-author{color:var(--amber)}.action-human{color:var(--blue);border-color:#1f3450}
.depth-deep{color:#ff9d9d}.tag-agent{color:#d9b3ff;border-color:#3d2a5a}.tag-risk{color:#ff9d9d}.muted{color:var(--muted)}
.card-foot{display:flex;gap:14px;flex-wrap:wrap;margin-top:8px;font-size:12px;color:var(--muted)}.author{color:var(--text)}.suggest{color:#9fd3b4}
.empty{color:var(--muted);padding:40px;text-align:center;border:1px dashed var(--line);border-radius:12px}
@media (max-width:760px){.layout{grid-template-columns:1fr}nav{border-right:0;border-bottom:1px solid var(--line)}main{padding:16px}}
`;

export function renderBoard(input: BoardInput): string {
  const groups = groupByPriority(input.items);
  const builtIn = input.views.filter((v) => v.builtIn);
  const sidebar = [
    `<div class="brand"><i></i> carrot-review Triage</div>`,
    `<h3>Pull requests</h3>`,
    ...builtIn.map((v) => tab(input.repo, v, v.id === input.view.id, input.counts[v.id])),
    input.savedViews.length ? `<h3>Saved views</h3>` : "",
    ...input.savedViews.map((v) => tab(input.repo, v, v.id === input.view.id, input.counts[v.id])),
  ].join("\n");
  const body = groups.length ? groups.map(renderGroup).join("\n") : `<div class="empty">Nothing in this view.</div>`;
  const total = input.items.length;
  return [
    `<!doctype html>`,
    `<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`,
    `<title>Triage · ${e(input.repo)}</title><style>${CSS}</style></head>`,
    `<body><div class="layout"><nav>${sidebar}</nav><main>`,
    `<header><h1>${e(input.view.name)} <span class="count">${total}</span></h1><span class="sub">${e(input.repo)}${input.me ? ` · signed in as @${e(input.me)}` : ""} · generated ${e(input.generatedAt.toISOString())}</span></header>`,
    body,
    `</main></div></body></html>`,
  ].join("\n");
}

/** Plain-text board for the CLI. */
export function renderTerminalBoard(repo: string, viewName: string, items: TriageItem[]): string {
  const groups = groupByPriority(items);
  const lines = [`# Triage · ${repo} · ${viewName} (${items.length})`, ""];
  if (!groups.length) lines.push("Nothing in this view.");
  for (const g of groups) {
    lines.push(`## ${g.priority} ${g.label} (${g.items.length})`, "");
    for (const { signals: s, assessment: a } of g.items) {
      lines.push(`- #${s.number} ${s.title}`);
      lines.push(`    ${a.why}`);
      const bits = [a.nextAction, `${a.risk} risk`, a.reviewDepth, a.blastRadius !== "Low" ? `${a.blastRadius} blast radius` : "", `${a.complexity} complexity`, `${a.effort} effort`, ...a.tags].filter(Boolean);
      lines.push(`    ${bits.join(" · ")}`);
      lines.push(`    @${s.author}${a.suggestedReviewers.length ? ` → suggested: ${a.suggestedReviewers.map((r) => `@${r}`).join(", ")}` : ""} · score ${a.score}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
