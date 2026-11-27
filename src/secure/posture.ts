import { escapeHtml as e } from "../triage/board.js";
import { SEVERITY_RANK, type ScanResultLike, type SecSeverity, type SecurityFinding, type Verification } from "./schema.js";

export const SECURITY_MARKER = "<!-- carrot-review:security -->";

const SEV_ICON: Record<SecSeverity, string> = { Critical: "🔴", High: "🟠", Medium: "🟡", Low: "⚪" };

export interface AreaPosture {
  name: string;
  walked: number;
  total: number;
  critical: number;
  high: number;
  highOrCritical: number;
  medium: number;
  low: number;
  verified: number;
  needsReview: number;
  findings: SecurityFinding[];
}

export interface Posture {
  areas: AreaPosture[];
  totals: { findings: number; critical: number; high: number; medium: number; low: number; verified: number; needsReview: number; rejected: number; fixed: number; walked: number; total: number };
}

export interface PostureOptions {
  /** Files per top-level area in the whole repository; areas not listed count only walked files. */
  totalFiles?: Record<string, number>;
}

export const areaOf = (path: string): string => (path.includes("/") ? path.split("/")[0]! : "(root)");

export function buildPosture(result: ScanResultLike, opts: PostureOptions = {}): Posture {
  const areas = new Map<string, AreaPosture>();
  const get = (name: string) => {
    if (!areas.has(name)) areas.set(name, { name, walked: 0, total: opts.totalFiles?.[name] ?? 0, critical: 0, high: 0, highOrCritical: 0, medium: 0, low: 0, verified: 0, needsReview: 0, findings: [] });
    return areas.get(name)!;
  };
  for (const p of result.walked) get(areaOf(p)).walked++;
  for (const name of Object.keys(opts.totalFiles ?? {})) get(name);
  for (const a of areas.values()) a.total = Math.max(a.total, a.walked);
  for (const f of result.findings) {
    const a = get(areaOf(f.path));
    a.findings.push(f);
    if (f.severity === "Critical") a.critical++;
    else if (f.severity === "High") a.high++;
    else if (f.severity === "Medium") a.medium++;
    else a.low++;
    a.highOrCritical = a.critical + a.high;
    if (f.verification.verdict === "Confirmed") a.verified++;
    else if (f.verification.verdict === "Needs review") a.needsReview++;
  }
  const sorted = [...areas.values()].sort((x, y) => y.critical - x.critical || y.high - x.high || y.medium - x.medium || y.low - x.low || x.name.localeCompare(y.name));
  const t = { findings: result.findings.length, critical: 0, high: 0, medium: 0, low: 0, verified: 0, needsReview: 0, rejected: result.rejected.length, fixed: result.findings.filter((f) => f.fix?.pullRequestUrl).length, walked: result.walked.length, total: 0 };
  for (const a of sorted) { t.critical += a.critical; t.high += a.high; t.medium += a.medium; t.low += a.low; t.verified += a.verified; t.needsReview += a.needsReview; t.total += a.total; }
  return { areas: sorted, totals: t };
}

export function describeVerification(v: Verification): string {
  const ex = v.exploitability === "Not exploitable" ? "Not exploitable" : v.exploitability === "Unknown" ? "Unknown exploitability" : `${v.exploitability} to exploit`;
  const blast = v.blastRadius === "Unknown" ? "Unknown blast radius" : `${v.blastRadius} blast radius`;
  return `${v.reachability} · ${ex} · ${blast} · ${v.verdict}`;
}

function severityLine(findings: readonly SecurityFinding[]): string {
  const counts: Record<SecSeverity, number> = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  for (const f of findings) counts[f.severity]++;
  return (Object.keys(counts) as SecSeverity[]).filter((s) => counts[s]).map((s) => `${SEV_ICON[s]} ${counts[s]} ${s}`).join(" · ") || "no findings";
}

export function renderFindingMarkdown(f: SecurityFinding): string {
  const out = [
    `### ${SEV_ICON[f.severity]} ${f.severity} · ${f.title}`,
    "",
    `\`${f.path}:${f.line}${f.endLine && f.endLine > f.line ? `-${f.endLine}` : ""}\` · ${f.category}${f.cwe ? ` · ${f.cwe}` : ""}${f.ruleId ? ` · rule \`${f.ruleId}\`` : ""}`,
    "",
    `**Verification:** ${describeVerification(f.verification)}${f.verification.reasoning ? ` — ${f.verification.reasoning}` : ""}`,
    "",
    f.description,
  ];
  if (f.attackPath.length) out.push("", `**Attack path:** ${f.attackPath.join(" → ")}`);
  if (f.fixHint) out.push("", `**Fix:** ${f.fixHint}`);
  if (f.fix) out.push("", f.fix.pullRequestUrl ? `**Fix drafted:** ${f.fix.description} → ${f.fix.pullRequestUrl}` : `**Fix drafted:** ${f.fix.description}`, "", "```diff", f.fix.diff.trim(), "```");
  return out.join("\n");
}

/** The sticky security comment on a pull request, or the CLI report. */
export function renderScanMarkdown(result: ScanResultLike, opts: { repo?: string } = {}): string {
  const out = [SECURITY_MARKER, "", `## 🔒 Security scan${opts.repo ? ` · ${opts.repo}` : ""}`, "", `${severityLine(result.findings)} · ${result.walked.length} files walked · ${result.mode === "diff" ? "changed lines only" : "full files"}`, ""];
  if (!result.findings.length) out.push("No verified or pending security findings.", "");
  for (const f of result.findings) out.push(renderFindingMarkdown(f), "");
  if (result.rejected.length) {
    out.push("<details>", `<summary>Rejected by verification (${result.rejected.length})</summary>`, "");
    for (const f of result.rejected) out.push(`- \`${f.path}:${f.line}\` ${f.title} — ${f.verification.reasoning || "rejected"}`);
    out.push("", "</details>", "");
  }
  out.push(`<sub>Map (patterns) → Hunt (model) → Verify (reachability, exploitability, blast radius). Scanned ${result.scannedAt}.</sub>`);
  return out.join("\n");
}

const CSS = `
:root{--bg:#0b0d12;--panel:#12151d;--card:#171b26;--line:#232838;--text:#e6e8ee;--muted:#8b93a7;--accent:#ff7a1a;--red:#ff5d5d;--amber:#f2b134;--green:#2fbf71;--blue:#5b9cff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px}header{display:flex;justify-content:space-between;align-items:baseline;gap:16px}header h1{font-size:18px;margin:0}.sub{color:var(--muted);font-size:12px}
.brand{display:flex;align-items:center;gap:8px;font-weight:700;margin-bottom:14px}.brand i{width:10px;height:10px;border-radius:50%;background:var(--accent);display:inline-block}
h2{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:22px 0 10px}
.totals{display:flex;gap:10px;flex-wrap:wrap}.stat{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 14px;min-width:120px}.stat b{display:block;font-size:20px}.stat span{color:var(--muted);font-size:12px}
.map{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
.area{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px;border-top:3px solid var(--green)}.area.warn{border-top-color:var(--amber)}.area.bad{border-top-color:var(--red)}
.area h3{margin:0 0 4px;font-size:14px;display:flex;justify-content:space-between}.area .walk{color:var(--muted);font-size:12px}.area .row{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;font-size:12px}
.pill{border:1px solid var(--line);border-radius:999px;padding:1px 8px;color:var(--muted)}.pill.red{color:#ff9d9d;border-color:#5a1f1f}.pill.amber{color:#ffd18a;border-color:#5a4216}.pill.green{color:#9fd3b4;border-color:#1f4a33}.pill.grey{color:var(--muted)}
.finding{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin-bottom:10px}.finding h3{margin:0 0 4px;font-size:14px}.where{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:var(--muted)}
.finding p{margin:6px 0;color:var(--muted)}.path{font-family:ui-monospace,Menlo,monospace;font-size:12px}.path span{color:var(--accent)}
.sev{font-weight:700;padding:1px 7px;border-radius:6px;font-size:12px;margin-right:6px}.Critical{background:#4a1515;color:#ff8a8a}.High{background:#4a3315;color:#ffc46b}.Medium{background:#3d3a15;color:#f2e28a}.Low{background:#1d2230;color:var(--muted)}
.verify{font-size:12px;color:var(--muted)}.verify b{color:var(--text)}pre{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:8px;overflow:auto;font-size:12px}
details summary{cursor:pointer;color:var(--muted)}
`;

export interface PageOptions extends PostureOptions { repo: string }

/** Security posture page: the map by area, totals, then every finding. */
export function renderPosturePage(result: ScanResultLike, opts: PageOptions): string {
  const p = buildPosture(result, opts);
  const t = p.totals;
  const areas = p.areas.map((a) => {
    const cls = a.critical || a.high ? " bad" : a.medium ? " warn" : "";
    const unwalked = a.total - a.walked;
    return `<div class="area${cls}"><h3><span>${e(a.name)}</span><span class="walk">${a.walked}/${a.total}</span></h3><div class="row">${a.highOrCritical ? `<span class="pill red">${a.highOrCritical} high/critical</span>` : ""}${a.medium ? `<span class="pill amber">${a.medium} medium</span>` : ""}${a.verified ? `<span class="pill green">${a.verified} verified</span>` : ""}${unwalked > 0 ? `<span class="pill grey">Not yet walked: ${unwalked}</span>` : ""}${!a.findings.length && unwalked === 0 ? `<span class="pill green">clean</span>` : ""}</div></div>`;
  }).join("\n");
  const findings = result.findings.map((f) => `<div class="finding"><h3><span class="sev ${f.severity}">${f.severity}</span>${e(f.title)}</h3><div class="where">${e(f.path)}:${f.line} · ${e(f.category)}${f.cwe ? ` · ${e(f.cwe)}` : ""}</div><div class="verify"><b>Verification:</b> ${e(describeVerification(f.verification))}${f.verification.reasoning ? ` — ${e(f.verification.reasoning)}` : ""}</div><p>${e(f.description)}</p>${f.attackPath.length ? `<div class="path">${f.attackPath.map((s) => e(s)).join(' <span>→</span> ')}</div>` : ""}${f.fixHint ? `<p><b>Fix:</b> ${e(f.fixHint)}</p>` : ""}${f.fix ? `<p><b>Fix drafted:</b> ${e(f.fix.description)}${f.fix.pullRequestUrl ? ` · <a href="${e(f.fix.pullRequestUrl)}">${e(f.fix.pullRequestUrl)}</a>` : ""}</p><pre>${e(f.fix.diff)}</pre>` : ""}</div>`).join("\n");
  const rejected = result.rejected.length ? `<details><summary>Rejected by verification (${result.rejected.length})</summary>${result.rejected.map((f) => `<div class="finding"><h3>${e(f.title)}</h3><div class="where">${e(f.path)}:${f.line}</div><p>${e(f.verification.reasoning)}</p></div>`).join("")}</details>` : "";
  return [
    `<!doctype html>`,
    `<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Security · ${e(opts.repo)}</title><style>${CSS}</style></head>`,
    `<body><main><div class="brand"><i></i> carrot-review Secure</div>`,
    `<header><h1>Security posture · ${e(opts.repo)}</h1><span class="sub">${result.mode === "diff" ? "PR scan" : "Deep scan"} · ${e(result.scannedAt)}</span></header>`,
    `<h2>Repository posture</h2><div class="totals"><div class="stat"><b>${t.critical + t.high}</b><span>high / critical</span></div><div class="stat"><b>${t.medium}</b><span>medium</span></div><div class="stat"><b>${t.verified}</b><span>verified</span></div><div class="stat"><b>${t.needsReview}</b><span>needs review</span></div><div class="stat"><b>${t.rejected}</b><span>rejected as noise</span></div><div class="stat"><b>${t.fixed}</b><span>fix PRs opened</span></div><div class="stat"><b>${t.walked}/${t.total}</b><span>files walked</span></div></div>`,
    `<h2>Attack surface by area</h2><div class="map">${areas}</div>`,
    `<h2>Findings (${result.findings.length})</h2>${findings || '<p class="sub">No verified or pending findings.</p>'}${rejected}`,
    `</main></body></html>`,
  ].join("\n");
}
