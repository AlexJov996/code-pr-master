import { escapeHtml as e } from "../triage/board.js";
import { describeStep } from "./runner.js";
import type { JourneyRun, VerifyRun } from "./schema.js";

export const VERIFY_MARKER = "<!-- carrot-review:verify -->";

const ICON: Record<JourneyRun["status"], string> = { passed: "✅", failed: "❌", blocked: "⛔" };

function summaryLine(run: VerifyRun): string {
  const s = run.summary;
  const parts = [`${s.failed} bug${s.failed === 1 ? "" : "s"}`, `${s.passed} passed`];
  if (s.blocked) parts.push(`${s.blocked} blocked`);
  return parts.join(" · ");
}

/** The sticky Verify comment on a pull request, or the CLI report. */
export function renderVerifyMarkdown(run: VerifyRun): string {
  const out = [VERIFY_MARKER, "", `## 🧪 Verify · ${summaryLine(run)}`, "", `Tested ${run.baseUrl}${run.revision ? ` at \`${run.revision}\`` : ""} · ${run.environment.browser} · ${run.runs.length} scenario${run.runs.length === 1 ? "" : "s"} · ${run.startedAt}`, ""];
  for (const r of run.runs) {
    out.push(`### ${ICON[r.status]} ${r.journey.title}`, "", `_${r.journey.goal}_`, "");
    if (r.finding) {
      out.push(`**Bug found: ${r.finding.title}**`, "", `**Expected:** ${r.finding.expected}`, "", `**Observed:** ${r.finding.observed}`, "", `**Developer guidance:** ${r.finding.guidance}`, "");
    } else if (r.status === "blocked") {
      const first = r.steps.find((s) => s.status === "failed");
      out.push(`Blocked before the scenario could start: ${first?.error ?? "unknown error"}`, "");
    }
    out.push("<details>", `<summary>Steps (${r.steps.filter((s) => s.status === "passed").length}/${r.steps.length} passed) and evidence</summary>`, "");
    r.steps.forEach((s) => out.push(`${s.index + 1}. ${s.status === "passed" ? "✅" : s.status === "failed" ? "❌" : "⏭️"} ${describeStep(s.step)}${s.error ? ` — ${s.error}` : ""}`));
    if (r.evidence.recording || r.evidence.screenshots.length) {
      out.push("", "Evidence:", ...(r.evidence.recording ? [`- recording: \`${r.evidence.recording}\``] : []), ...r.evidence.screenshots.map((s) => `- \`${s}\``));
    }
    out.push("", "</details>", "");
  }
  out.push(`<sub>Scenarios ${run.runs.some((r) => r.journey.source === "generated") ? "generated from the PR diff and codebase context" : "from the saved journeys"}. Comment \`@carrot-review verify\` to run again.</sub>`);
  return out.join("\n");
}

/** Everything a coding agent needs to reproduce and fix one failed scenario. */
export function renderRepairHandoff(run: VerifyRun, r: JourneyRun): string {
  const f = r.finding;
  const out = [
    `# Repair handoff: ${f?.title ?? r.journey.title}`, "",
    "## Finding", "",
    `- Scenario: ${r.journey.title} (${r.journey.id})`,
    `- Goal: ${r.journey.goal}`,
    `- Expected: ${f?.expected ?? r.journey.expected ?? "(see steps)"}`,
    `- Observed: ${f?.observed ?? "(see failed step)"}`,
    `- Developer guidance: ${f?.guidance ?? "Reproduce the steps and inspect the failing state."}`, "",
    "## Environment", "",
    `- Tested revision: ${run.revision ?? "unknown"}`,
    `- Base URL: ${run.baseUrl}`,
    `- Browser: ${run.environment.browser}, viewport ${run.environment.viewport}, headless ${run.environment.headless}`,
    `- Run: ${run.id} at ${run.startedAt}`, "",
    "## Steps to reproduce", "",
    ...r.steps.map((s) => `${s.index + 1}. ${describeStep(s.step)}${s.status === "failed" ? ` ← failed: ${s.error ?? ""}` : s.status === "skipped" ? " (skipped)" : ""}${s.url && s.status !== "skipped" ? ` [${s.url}]` : ""}`), "",
    "## Evidence", "",
    ...(r.evidence.recording ? [`- Recording: ${r.evidence.recording}`] : []),
    ...r.evidence.screenshots.map((s, i) => `- Screenshot after step ${i + 1}: ${s}`),
  ];
  const errors = r.evidence.logs.filter((l) => l.level === "error" || l.level === "pageerror");
  if (errors.length) out.push("", "## Console errors", "", ...errors.map((l) => `- [${l.level}] ${l.text}`));
  const failedNet = r.evidence.network.filter((n) => n.failed || (n.status ?? 0) >= 400);
  if (failedNet.length) out.push("", "## Failed requests", "", ...failedNet.map((n) => `- ${n.method} ${n.url} → ${n.failed ? "failed" : n.status}`));
  out.push("", "## Instructions for the agent", "", "Verify the finding against the current code before changing anything. Fix the root cause, keep the change minimal, add or update a test that reproduces the scenario, and re-run the journey to confirm.");
  return out.join("\n");
}

const CSS = `
:root{--bg:#0b0d12;--panel:#12151d;--card:#171b26;--line:#232838;--text:#e6e8ee;--muted:#8b93a7;--accent:#ff7a1a;--red:#ff5d5d;--green:#2fbf71;--amber:#f2b134}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.layout{display:grid;grid-template-columns:320px 1fr;min-height:100vh}nav{background:var(--panel);border-right:1px solid var(--line);padding:16px}main{padding:20px 24px;min-width:0}
.brand{display:flex;align-items:center;gap:8px;font-weight:700;margin-bottom:12px}.brand i{width:10px;height:10px;border-radius:50%;background:var(--accent);display:inline-block}
h3{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:16px 0 6px}.sub{color:var(--muted);font-size:12px}
.scenario{display:block;width:100%;text-align:left;background:none;border:1px solid transparent;color:var(--text);padding:9px 10px;border-radius:10px;cursor:pointer;font:inherit;margin-bottom:4px}
.scenario:hover{background:var(--card)}.scenario.active{background:var(--card);border-color:var(--line);box-shadow:inset 2px 0 0 var(--accent)}.scenario small{display:block;color:var(--muted)}
.scenario.failed small{color:#ff9d9d}.scenario.passed small{color:#9fd3b4}.scenario.blocked small{color:#ffd18a}
section.detail{display:none}section.detail.active{display:block}header h1{font-size:18px;margin:0 0 4px}
.bug{background:#2a1515;border:1px solid #5a1f1f;border-radius:12px;padding:12px 14px;margin:12px 0}.bug b{display:block;color:#ff9d9d;margin-bottom:6px}.bug dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:4px 12px}.bug dt{color:var(--muted)}.bug dd{margin:0}
.tabs{display:flex;gap:6px;margin:14px 0 8px}.tab{border:1px solid var(--line);border-radius:999px;padding:3px 12px;cursor:pointer;background:none;color:var(--muted);font:inherit}.tab.active{color:var(--text);border-color:var(--accent)}
.pane{display:none}.pane.active{display:block}video{max-width:100%;border-radius:10px;border:1px solid var(--line);background:#000}
.shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}.shot{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:6px}.shot img{width:100%;border-radius:6px}.shot figcaption{font-size:12px;color:var(--muted);margin-top:4px}.shot.failed{border-color:#5a1f1f}
pre{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px;overflow:auto;font-size:12px;white-space:pre-wrap}
.steps{list-style:none;padding:0;margin:8px 0}.steps li{padding:4px 0;border-bottom:1px solid var(--line);font-size:13px}.steps .err{color:#ff9d9d}
.handoff{margin-top:16px}.handoff button{background:var(--accent);color:#000;border:0;border-radius:8px;padding:6px 12px;font:inherit;cursor:pointer}
@media (max-width:900px){.layout{grid-template-columns:1fr}nav{border-right:0;border-bottom:1px solid var(--line)}section.detail{display:block}}
`;

const JS = `
function show(i){document.querySelectorAll('.scenario').forEach(b=>b.classList.toggle('active',b.dataset.i===String(i)));document.querySelectorAll('section.detail').forEach(s=>s.classList.toggle('active',s.dataset.i===String(i)))}
document.querySelectorAll('.scenario').forEach(b=>b.addEventListener('click',()=>show(b.dataset.i)));
document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>{const sec=t.closest('section');sec.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===t));sec.querySelectorAll('.pane').forEach(p=>p.classList.toggle('active',p.dataset.pane===t.dataset.pane))}));
document.querySelectorAll('.handoff button').forEach(b=>b.addEventListener('click',()=>{navigator.clipboard.writeText(b.nextElementSibling.textContent).then(()=>{b.textContent='Copied';setTimeout(()=>b.textContent='Copy repair handoff',1500)})}));
`;

export interface PageOptions { artifactBase: string }

/** The Verify run page: scenarios on the left; finding, evidence tabs and the repair handoff on the right. */
export function renderVerifyPage(run: VerifyRun, opts: PageOptions): string {
  const art = (p: string) => `${opts.artifactBase.replace(/\/$/, "")}/${p.split("/").map(encodeURIComponent).join("/")}`;
  const nav = run.runs.map((r, i) => `<button class="scenario ${r.status}${i === 0 ? " active" : ""}" data-i="${i}">${e(r.journey.title)}<small>${String(i + 1).padStart(2, "0")} · ${r.status === "failed" ? "Bug found" : r.status === "passed" ? "Passed" : "Blocked"}</small></button>`).join("\n");
  const details = run.runs.map((r, i) => {
    const f = r.finding;
    const bug = f ? `<div class="bug"><b>Bug found · ${e(f.title)}</b><dl><dt>Expected</dt><dd>${e(f.expected)}</dd><dt>Observed</dt><dd>${e(f.observed)}</dd><dt>Developer guidance</dt><dd>${e(f.guidance)}</dd></dl></div>` : r.status === "passed" ? `<p class="sub">Passed. ${e(r.journey.expected ?? "")}</p>` : `<div class="bug"><b>Blocked</b>${e(r.steps.find((s) => s.status === "failed")?.error ?? "")}</div>`;
    const video = r.evidence.recording ? `<video controls src="${art(r.evidence.recording)}"></video>` : `<p class="sub">No recording.</p>`;
    const shots = r.evidence.screenshots.length ? `<div class="shots">${r.steps.filter((s) => s.screenshot).map((s) => `<figure class="shot ${s.status}"><img src="${art(s.screenshot!)}" alt="After step ${s.index + 1}"><figcaption>${s.index + 1}. ${e(describeStep(s.step))} · ${s.status}</figcaption></figure>`).join("")}</div>` : `<p class="sub">No screenshots.</p>`;
    const logs = `<pre>${e([...r.evidence.logs.map((l) => `[${l.ts}ms] ${l.level}: ${l.text}`), "", ...r.evidence.network.map((n) => `[${n.ts}ms] ${n.method} ${n.url} → ${n.failed ? "failed" : n.status}`)].join("\n")) || "(empty)"}</pre>`;
    const steps = `<ul class="steps">${r.steps.map((s) => `<li>${s.status === "passed" ? "✅" : s.status === "failed" ? "❌" : "⏭️"} ${e(describeStep(s.step))}${s.error ? ` <span class="err">— ${e(s.error)}</span>` : ""}</li>`).join("")}</ul>`;
    const handoff = r.status !== "passed" ? `<div class="handoff"><h3>Repair handoff</h3><button type="button">Copy repair handoff</button><pre>${e(renderRepairHandoff(run, r))}</pre></div>` : "";
    return `<section class="detail${i === 0 ? " active" : ""}" data-i="${i}"><header><h1>${e(r.journey.title)}</h1><p class="sub">${e(r.journey.goal)} · ${Math.round(r.durationMs / 100) / 10}s</p></header>${bug}${steps}<div class="tabs"><button class="tab active" data-pane="recording">Recording</button><button class="tab" data-pane="screenshots">Screenshots</button><button class="tab" data-pane="logs">Logs</button></div><div class="pane active" data-pane="recording">${video}</div><div class="pane" data-pane="screenshots">${shots}</div><div class="pane" data-pane="logs">${logs}</div>${handoff}</section>`;
  }).join("\n");
  return [
    `<!doctype html>`,
    `<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Verify · ${e(run.id)}</title><style>${CSS}</style></head>`,
    `<body><div class="layout"><nav><div class="brand"><i></i> carrot-review Verify</div><div class="sub">${e(run.baseUrl)}${run.revision ? ` · ${e(run.revision)}` : ""}<br>${e(summaryLine(run))} · ${e(run.environment.browser)}</div><h3>Scenarios</h3>${nav}</nav><main>${details}</main></div><script>${JS}</script></body></html>`,
  ].join("\n");
}
