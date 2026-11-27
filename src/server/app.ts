import { Webhooks } from "@octokit/webhooks";
import { Hono } from "hono";
import { renderBoard } from "../triage/board.js";
import { explainChanges, type ExplainInput } from "../understand/explain.js";
import { renderExplainMarkdown, renderExplainPage } from "../understand/render.js";
import type { ChangeStackOutput } from "../understand/schema.js";
import type { StructuredGenerate } from "../core/claude.js";
import { buildPosture, renderPosturePage, renderScanMarkdown } from "../secure/posture.js";
import { promises as fs } from "node:fs";
import { join, resolve, extname } from "node:path";
import { renderVerifyMarkdown, renderVerifyPage } from "../verify/report.js";
import type { VerifyRun } from "../verify/schema.js";
import { escapeHtml } from "../triage/board.js";
import type { ScanResult } from "../secure/schema.js";
import { applyView, BUILT_IN_VIEWS, countsByView, groupByPriority, resolveView, type SavedView, type TriageItem } from "../triage/views.js";

export interface TriageDeps {
  /** Load scored items for "owner/name". */
  load: (repo: string) => Promise<TriageItem[]>;
  me?: string;
  savedViews?: SavedView[];
}

export interface ExplainDeps {
  /** Fetch title, description and diff for "owner/name" and a pull request number. */
  load: (repo: string, number: number) => Promise<ExplainInput>;
  /** Model call; omitted means the heuristic walkthrough. */
  generate?: StructuredGenerate<ChangeStackOutput>;
}

export interface SecureDeps {
  /** The latest stored scan for "owner/name", or undefined when none exists. */
  load: (repo: string) => Promise<{ result: ScanResult; totalFiles?: Record<string, number> } | undefined>;
}

export interface VerifyDeps {
  /** Directory holding one sub-directory per run, each with run.json and its evidence files. */
  runsDir: string;
}

export interface ServerDeps {
  webhookSecret: string;
  onPullRequest: (payload: any) => Promise<void>;
  onIssueComment: (payload: any) => Promise<void>;
  triage?: TriageDeps;
  explain?: ExplainDeps;
  secure?: SecureDeps;
  verify?: VerifyDeps;
  log?: (msg: string) => void;
}

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

const HANDLED = new Set(["pull_request", "issue_comment"]);

/** Hono app: health check plus a signature-verified GitHub webhook endpoint. Work runs after the 202 is sent. */
export function createApp(deps: ServerDeps) {
  const log = deps.log ?? ((m) => console.log(m));
  const webhooks = new Webhooks({ secret: deps.webhookSecret });
  const app = new Hono();

  app.get("/healthz", (c) => c.json({ ok: true }));

  app.post("/api/webhooks/github", async (c) => {
    const event = c.req.header("x-github-event") ?? "";
    const signature = c.req.header("x-hub-signature-256") ?? "";
    const body = await c.req.text();
    if (!(await webhooks.verify(body, signature))) return c.text("invalid signature", 401);
    if (!HANDLED.has(event)) return c.body(null, 204);

    const payload = JSON.parse(body);
    const run = event === "pull_request" ? deps.onPullRequest : deps.onIssueComment;
    // GitHub times out webhooks after 10s; a review takes longer, so acknowledge now and work in the background.
    queueMicrotask(() => {
      run(payload).catch((err: unknown) => log(`[${event}] handler failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`));
    });
    return c.text("accepted", 202);
  });

  if (deps.triage) {
    const t = deps.triage;
    const saved = t.savedViews ?? [];
    const views = [...BUILT_IN_VIEWS, ...saved.map((v) => ({ ...v, builtIn: false }))];
    const prepare = async (repo: string | undefined, viewId: string | undefined) => {
      if (!repo || !REPO_RE.test(repo)) return undefined;
      const items = await t.load(repo);
      const view = resolveView(viewId, saved);
      return { repo, view, items: applyView(items, view, t.me), counts: countsByView(items, views, t.me), generatedAt: new Date() };
    };

    app.get("/triage", async (c) => {
      const data = await prepare(c.req.query("repo"), c.req.query("view"));
      if (!data) return c.text("Pass ?repo=owner/name", 400);
      return c.html(renderBoard({ ...data, me: t.me, views, savedViews: saved }));
    });

    app.get("/api/triage.json", async (c) => {
      const data = await prepare(c.req.query("repo"), c.req.query("view"));
      if (!data) return c.json({ error: "Pass ?repo=owner/name" }, 400);
      return c.json({ repo: data.repo, view: data.view.id, generatedAt: data.generatedAt.toISOString(), counts: data.counts, groups: groupByPriority(data.items) });
    });
  }

  if (deps.explain) {
    const x = deps.explain;
    const prepare = async (repo: string | undefined, pr: string | undefined) => {
      const number = Number(pr);
      if (!repo || !REPO_RE.test(repo) || !Number.isInteger(number) || number <= 0) return undefined;
      const input = await x.load(repo, number);
      return { repo, number, result: await explainChanges(input, { generate: x.generate }) };
    };
    const bad = "Pass ?repo=owner/name&pr=<number>";
    app.get("/explain", async (c) => {
      const d = await prepare(c.req.query("repo"), c.req.query("pr"));
      return d ? c.html(renderExplainPage(d.result, { repo: d.repo, number: d.number })) : c.text(bad, 400);
    });
    app.get("/api/explain.md", async (c) => {
      const d = await prepare(c.req.query("repo"), c.req.query("pr"));
      return d ? c.text(renderExplainMarkdown(d.result), 200, { "content-type": "text/markdown; charset=utf-8" }) : c.text(bad, 400);
    });
    app.get("/api/explain.json", async (c) => {
      const d = await prepare(c.req.query("repo"), c.req.query("pr"));
      return d ? c.json({ repo: d.repo, number: d.number, stack: d.result.stack, overview: d.result.overview, layerStats: d.result.layerStats, semantic: d.result.semantic }) : c.json({ error: bad }, 400);
    });
  }

  if (deps.secure) {
    const sec = deps.secure;
    const prepare = async (repo: string | undefined) => {
      if (!repo || !REPO_RE.test(repo)) return { status: 400 as const };
      const stored = await sec.load(repo);
      return stored ? { status: 200 as const, repo, ...stored } : { status: 404 as const };
    };
    app.get("/secure", async (c) => {
      const d = await prepare(c.req.query("repo"));
      if (d.status !== 200) return c.text(d.status === 400 ? "Pass ?repo=owner/name" : "No scan stored for this repository. Run `carrot-review secure scan --save` first.", d.status);
      return c.html(renderPosturePage(d.result, { repo: d.repo, totalFiles: d.totalFiles }));
    });
    app.get("/api/secure.json", async (c) => {
      const d = await prepare(c.req.query("repo"));
      if (d.status !== 200) return c.json({ error: d.status === 400 ? "Pass ?repo=owner/name" : "No scan stored" }, d.status);
      return c.json({ repo: d.repo, result: d.result, posture: buildPosture(d.result, { totalFiles: d.totalFiles }) });
    });
    app.get("/api/secure.md", async (c) => {
      const d = await prepare(c.req.query("repo"));
      if (d.status !== 200) return c.text(d.status === 400 ? "Pass ?repo=owner/name" : "No scan stored", d.status);
      return c.text(renderScanMarkdown(d.result, { repo: d.repo }), 200, { "content-type": "text/markdown; charset=utf-8" });
    });
  }

  if (deps.verify) {
    const runsDir = resolve(deps.verify.runsDir);
    const RUN_ID = /^[\w.-]+$/;
    const loadRun = async (id: string | undefined): Promise<VerifyRun | undefined> => {
      if (!id || !RUN_ID.test(id)) return undefined;
      try { return JSON.parse(await fs.readFile(join(runsDir, id, "run.json"), "utf8")) as VerifyRun; } catch { return undefined; }
    };
    const listRuns = async (): Promise<VerifyRun[]> => {
      let names: string[] = [];
      try { names = await fs.readdir(runsDir); } catch { return []; }
      const runs = await Promise.all(names.map((n) => loadRun(n)));
      return runs.filter((r): r is VerifyRun => Boolean(r)).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    };
    const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".webm": "video/webm", ".json": "application/json", ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8" };

    app.get("/verify", async (c) => {
      const id = c.req.query("run");
      if (id) {
        const run = await loadRun(id);
        if (!run) return c.text("No such run", 404);
        return c.html(renderVerifyPage(run, { artifactBase: `/verify/artifacts/${encodeURIComponent(run.id)}` }));
      }
      const runs = await listRuns();
      const rows = runs.map((r) => `<li><a href="/verify?run=${encodeURIComponent(r.id)}">${escapeHtml(r.id)}</a> · ${r.summary.failed} bug${r.summary.failed === 1 ? "" : "s"} · ${r.summary.passed} passed${r.summary.blocked ? ` · ${r.summary.blocked} blocked` : ""} · ${escapeHtml(r.baseUrl)}${r.revision ? ` @ ${escapeHtml(r.revision)}` : ""} · ${escapeHtml(r.startedAt)}</li>`).join("");
      return c.html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Verify runs</title><style>body{font:14px system-ui;background:#0b0d12;color:#e6e8ee;margin:40px auto;max-width:900px}a{color:#ff7a1a}li{padding:6px 0;border-bottom:1px solid #232838}</style></head><body><h1>Verify runs</h1>${rows ? `<ul>${rows}</ul>` : "<p>No runs yet. Run <code>carrot-review verify run</code> or <code>carrot-review verify demo</code>.</p>"}</body></html>`);
    });

    app.get("/verify/artifacts/:run/*", async (c) => {
      const id = c.req.param("run");
      const rest = c.req.path.slice(`/verify/artifacts/${id}/`.length).split("/").map((s) => decodeURIComponent(s));
      if (!RUN_ID.test(id) || rest.some((s) => s === ".." || s === "" || s.includes("\\"))) return c.text("bad path", 400);
      const file = resolve(runsDir, id, ...rest);
      if (!file.startsWith(resolve(runsDir, id) + "/")) return c.text("bad path", 400);
      try {
        const data = await fs.readFile(file);
        return c.body(data, 200, { "content-type": MIME[extname(file)] ?? "application/octet-stream", "cache-control": "private, max-age=3600" });
      } catch { return c.text("not found", 404); }
    });

    app.get("/api/verify.json", async (c) => {
      const run = await loadRun(c.req.query("run"));
      return run ? c.json(run) : c.json({ error: "No such run" }, 404);
    });
    app.get("/api/verify.md", async (c) => {
      const run = await loadRun(c.req.query("run"));
      return run ? c.text(renderVerifyMarkdown(run), 200, { "content-type": "text/markdown; charset=utf-8" }) : c.text("No such run", 404);
    });
  }

  return app;
}
