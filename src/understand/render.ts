import type { FileDiff } from "../core/diff.js";
import { escapeHtml as e } from "../triage/board.js";
import type { ExplainResult } from "./explain.js";
import type { Complexity } from "./schema.js";

export const EXPLAIN_MARKER = "<!-- carrot-review:explain -->";

const COMPLEXITY_ICON: Record<Complexity, string> = { High: "🔴", Medium: "🟠", Low: "🟢" };
const pad2 = (n: number) => String(n).padStart(2, "0");
const safeLabel = (s: string) => s.replace(/[^\w\s.\-/():]/g, "");

/** Mermaid flowchart of the architecture edges, or of the layer dependencies when there are none. */
export function renderMermaid(r: ExplainResult): string {
  const lines = ["flowchart LR"];
  if (r.stack.architecture.length) {
    const ids = new Map<string, string>();
    const id = (name: string) => {
      if (!ids.has(name)) { ids.set(name, `N${ids.size}`); lines.push(`  ${ids.get(name)}["${safeLabel(name)}"]`); }
      return ids.get(name)!;
    };
    for (const edge of r.stack.architecture) {
      const a = id(edge.from), b = id(edge.to);
      lines.push(edge.label ? `  ${a} -->|${safeLabel(edge.label)}| ${b}` : `  ${a} --> ${b}`);
    }
  } else {
    r.stack.layers.forEach((l, i) => lines.push(`  L${i}["${pad2(i + 1)} ${safeLabel(l.title)}"]`));
    r.stack.layers.forEach((l, i) => l.dependsOn.forEach((d) => lines.push(`  L${d} --> L${i}`)));
  }
  return lines.join("\n");
}

function fileLine(r: ExplainResult, path: string): string {
  const f = r.files.find((x) => x.path === path);
  const changes = (r.semantic[path] ?? []).filter((c) => c.symbolKind !== "import");
  const sym = changes.length ? `: ${changes.map((c) => `${c.kind} \`${c.symbol}\``).join(", ")}` : "";
  return `- \`${path}\`${f ? ` (${f.status}, +${f.additions}/−${f.deletions})` : ""}${sym}`;
}

/** Markdown walkthrough for a pull request comment or the terminal. */
export function renderExplainMarkdown(r: ExplainResult): string {
  const out: string[] = [EXPLAIN_MARKER, "", `# ${r.stack.title}`, "", r.stack.summary, ""];
  out.push(`**Blast radius:** ${r.overview.blastRadius} · ${r.overview.files} files · +${r.overview.additions}/−${r.overview.deletions} · areas: ${r.overview.areas.join(", ")}`);
  if (r.overview.attention.length) out.push("", "**Before approving:**", "", ...r.overview.attention.map((a) => `- ${a}`));
  out.push("", "## Change stack", "");
  r.stack.layers.forEach((l, i) => {
    const st = r.layerStats[i]!;
    const deps = l.dependsOn.length ? ` · depends on ${l.dependsOn.map((d) => pad2(d + 1)).join(", ")}` : "";
    out.push(`### ${pad2(i + 1)} ${l.title} · ${st.files} file${st.files === 1 ? "" : "s"} · +${st.additions}/−${st.deletions}${deps}`, "", l.description, "");
    for (const p of l.files) out.push(fileLine(r, p));
    if (l.risks.length) out.push("", ...l.risks.map((x) => `> ⚠️ ${x}`));
    out.push("");
  });
  if (r.stack.summaries.length) {
    out.push("## What to read first", "", "| Complexity | Region | Symbol | Summary |", "|---|---|---|---|");
    for (const s of r.stack.summaries) out.push(`| ${COMPLEXITY_ICON[s.complexity]} ${s.complexity} | \`${s.path}:${s.startLine}-${s.endLine}\` | ${s.symbol ? `\`${s.symbol}\`` : ""} | ${s.summary.replace(/\|/g, "\\|")} |`);
    out.push("");
  }
  out.push("## Architecture", "", "```mermaid", renderMermaid(r), "```", "");
  out.push(`<sub>Walkthrough by carrot-review (${r.stack.source === "model" ? "model-assisted" : "heuristic"}).</sub>`);
  return out.join("\n");
}

function renderDiffTable(f: FileDiff): string {
  const rows: string[] = [];
  let prevNew: number | undefined;
  for (const h of f.hunks) {
    if (prevNew !== undefined && h.newStart > prevNew + 1) rows.push(`<tr class="gap"><td colspan="3">${h.newStart - prevNew - 1} unmodified lines</td></tr>`);
    for (const l of h.lines) {
      const cls = l.type === "add" ? "add" : l.type === "del" ? "del" : "ctx";
      rows.push(`<tr class="${cls}"><td class="ln">${l.oldLine ?? ""}</td><td class="ln">${l.newLine ?? ""}</td><td class="code">${e(l.content)}</td></tr>`);
      if (l.newLine !== undefined) prevNew = l.newLine;
    }
  }
  return `<table class="diff">${rows.join("")}</table>`;
}

const PAGE_CSS = `
:root{--bg:#0b0d12;--panel:#12151d;--card:#171b26;--line:#232838;--text:#e6e8ee;--muted:#8b93a7;--accent:#ff7a1a;--add:#15351f;--del:#3a1a1a}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
a{color:inherit;text-decoration:none}
.layout{display:grid;grid-template-columns:280px 1fr 320px;min-height:100vh}
nav,aside{background:var(--panel);padding:16px;border-color:var(--line)}nav{border-right:1px solid var(--line)}aside{border-left:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:8px;font-weight:700;margin-bottom:12px}.brand i{width:10px;height:10px;border-radius:50%;background:var(--accent);display:inline-block}
h3{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:16px 0 6px}
.overview{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-size:12px;color:var(--muted);margin-bottom:10px}.overview b{color:var(--text)}
.layer{display:block;width:100%;text-align:left;background:none;border:1px solid transparent;color:var(--text);padding:9px 10px;border-radius:10px;cursor:pointer;font:inherit}
.layer:hover{background:var(--card)}.layer.active{background:var(--card);border-color:var(--line);box-shadow:inset 2px 0 0 var(--accent)}
.layer .num{color:var(--accent);font-weight:700;margin-right:8px}.layer small{display:block;color:var(--muted);margin-top:2px}
main{padding:20px 24px;min-width:0}header h1{font-size:18px;margin:0 0 4px}header p{color:var(--muted);margin:0 0 14px}
section.stack-layer{display:none}section.stack-layer.active{display:block}
.layer-head{margin:6px 0 12px}.layer-head h2{font-size:16px;margin:0}.layer-head p{color:var(--muted);margin:4px 0}.deps{font-size:12px;color:var(--muted)}
.risk{background:#3a2a10;border:1px solid #5a4216;color:#ffd18a;border-radius:8px;padding:8px 10px;margin:8px 0;font-size:13px}
.file{background:var(--card);border:1px solid var(--line);border-radius:12px;margin-bottom:12px;overflow:hidden}
.file-head{display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--line);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
.file-head .stat{color:var(--muted)}.file-head .add{color:#6fd39b}.file-head .del{color:#ff8a8a}.file-head .spacer{flex:1}
.file-head button{background:none;border:1px solid var(--line);color:var(--muted);border-radius:6px;padding:3px 8px;cursor:pointer;font:inherit}
.file.viewed .file-head button{color:#6fd39b;border-color:#1f4a33}.file.viewed .diff{display:none}
.diff{width:100%;border-collapse:collapse;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
.diff td{padding:0 8px;white-space:pre;vertical-align:top}.diff .ln{width:46px;text-align:right;color:var(--muted);user-select:none;border-right:1px solid var(--line)}
.diff tr.add td{background:var(--add)}.diff tr.del td{background:var(--del)}.diff tr.gap td{color:var(--muted);text-align:center;background:var(--panel);font-size:11px;padding:3px}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}.chip{border:1px solid var(--line);border-radius:999px;padding:2px 10px;font-size:12px;cursor:pointer;background:none;color:var(--muted);font:inherit}.chip.on{color:var(--text);border-color:var(--accent)}
.sum{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 10px;margin-bottom:8px;font-size:12.5px}.sum .where{font-family:ui-monospace,Menlo,monospace;color:var(--muted);font-size:11.5px}.sum b{display:block;margin:2px 0}
.sum.High{border-left:3px solid #ff5d5d}.sum.Medium{border-left:3px solid #f2b134}.sum.Low{border-left:3px solid #2fbf71}
.mermaid{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px;margin-top:10px}
@media (max-width:1100px){.layout{grid-template-columns:1fr}nav,aside{border:0;border-bottom:1px solid var(--line)}section.stack-layer{display:block}}
`;

const PAGE_JS = `
const key=location.pathname+location.search;
const viewed=new Set(JSON.parse(localStorage.getItem('viewed:'+key)||'[]'));
document.querySelectorAll('.file').forEach(f=>{if(viewed.has(f.dataset.path))f.classList.add('viewed')});
document.querySelectorAll('.file-head button').forEach(b=>b.addEventListener('click',()=>{const f=b.closest('.file');f.classList.toggle('viewed');if(f.classList.contains('viewed'))viewed.add(f.dataset.path);else viewed.delete(f.dataset.path);localStorage.setItem('viewed:'+key,JSON.stringify([...viewed]))}));
function showLayer(i){document.querySelectorAll('.layer').forEach(b=>b.classList.toggle('active',b.dataset.layer===String(i)));document.querySelectorAll('section.stack-layer').forEach(s=>s.classList.toggle('active',s.dataset.layer===String(i)))}
document.querySelectorAll('.layer').forEach(b=>b.addEventListener('click',()=>showLayer(b.dataset.layer)));
document.querySelectorAll('.chip').forEach(c=>c.addEventListener('click',()=>{c.classList.toggle('on');const on=[...document.querySelectorAll('.chip.on')].map(x=>x.dataset.level);document.querySelectorAll('.sum').forEach(s=>{s.style.display=on.length===0||on.includes(s.dataset.level)?'':'none'})}));
if(window.mermaid){mermaid.initialize({startOnLoad:true,theme:'dark'})}
`;

export interface PageRef { repo: string; number: number; url?: string }

/** The Change Stack page: layers on the left, file diffs in the middle, context summaries on the right. */
export function renderExplainPage(r: ExplainResult, ref: PageRef): string {
  const ov = r.overview;
  const nav = [
    `<div class="brand"><i></i> carrot-review Explain</div>`,
    `<div class="overview"><b>${e(ref.repo)} #${ref.number}</b><br>${ov.files} files · +${ov.additions}/−${ov.deletions}<br>Blast radius: <b>${ov.blastRadius}</b>${ov.securitySensitive.length ? `<br>Security-sensitive: <b>${ov.securitySensitive.length}</b> file${ov.securitySensitive.length === 1 ? "" : "s"}` : ""}</div>`,
    `<h3>Layers</h3>`,
    ...r.stack.layers.map((l, i) => `<button class="layer${i === 0 ? " active" : ""}" data-layer="${i}"><span class="num">${pad2(i + 1)}</span>${e(l.title)}<small>${r.layerStats[i]!.files} file${r.layerStats[i]!.files === 1 ? "" : "s"} touched${l.risks.length ? ` · ${l.risks.length} risk${l.risks.length === 1 ? "" : "s"}` : ""}</small></button>`),
  ].join("\n");

  const sections = r.stack.layers.map((l, i) => {
    const st = r.layerStats[i]!;
    const deps = l.dependsOn.length ? `<div class="deps">Depends on ${l.dependsOn.map((d) => `${pad2(d + 1)} ${e(r.stack.layers[d]!.title)}`).join(", ")}</div>` : "";
    const files = l.files.map((p) => {
      const f = r.files.find((x) => x.path === p);
      if (!f) return "";
      return `<div class="file" data-path="${e(p)}"><div class="file-head"><span>${e(p)}</span><span class="stat"><span class="add">+${f.additions}</span> <span class="del">−${f.deletions}</span></span><span class="spacer"></span><button type="button">Mark viewed</button></div>${renderDiffTable(f)}</div>`;
    }).join("\n");
    return `<section class="stack-layer${i === 0 ? " active" : ""}" data-layer="${i}"><div class="layer-head"><h2>${pad2(i + 1)} ${e(l.title)} <span class="deps">· ${st.files} files · +${st.additions}/−${st.deletions}</span></h2><p>${e(l.description)}</p>${deps}</div>${l.risks.map((x) => `<div class="risk">⚠️ ${e(x)}</div>`).join("")}${files}</section>`;
  }).join("\n");

  const asideHtml = [
    `<h3>Context</h3>`,
    ov.attention.length ? `<div class="overview">${ov.attention.map((a) => `• ${e(a)}`).join("<br>")}</div>` : "",
    `<h3>Summaries (${r.stack.summaries.length})</h3>`,
    `<div class="chips">${(["High", "Medium", "Low"] as Complexity[]).map((c) => `<button type="button" class="chip" data-level="${c}">${COMPLEXITY_ICON[c]} ${c}</button>`).join("")}</div>`,
    ...r.stack.summaries.map((s) => `<div class="sum ${s.complexity}" data-level="${s.complexity}"><span class="where">${e(s.path)}:${s.startLine}-${s.endLine} · ${s.lines} lines</span>${s.symbol ? `<b>${e(s.symbol)}</b>` : ""}<span>${e(s.summary)}</span></div>`),
    `<h3>Architecture</h3>`,
    `<pre class="mermaid">${e(renderMermaid(r))}</pre>`,
  ].join("\n");

  return [
    `<!doctype html>`,
    `<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`,
    `<title>Change Stack · ${e(ref.repo)} #${ref.number}</title><style>${PAGE_CSS}</style>`,
    `<script src="https://cdnjs.cloudflare.com/ajax/libs/mermaid/11.12.0/mermaid.min.js"></script></head>`,
    `<body><div class="layout"><nav>${nav}</nav><main><header><h1>${e(r.stack.title)}</h1><p>${e(r.stack.summary)}</p></header>${sections}</main><aside>${asideHtml}</aside></div>`,
    `<script>${PAGE_JS}</script></body></html>`,
  ].join("\n");
}
