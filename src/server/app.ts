import { Webhooks } from "@octokit/webhooks";
import { Hono } from "hono";
import { renderBoard } from "../triage/board.js";
import { applyView, BUILT_IN_VIEWS, countsByView, groupByPriority, resolveView, type SavedView, type TriageItem } from "../triage/views.js";

export interface TriageDeps {
  /** Load scored items for "owner/name". */
  load: (repo: string) => Promise<TriageItem[]>;
  me?: string;
  savedViews?: SavedView[];
}

export interface ServerDeps {
  webhookSecret: string;
  onPullRequest: (payload: any) => Promise<void>;
  onIssueComment: (payload: any) => Promise<void>;
  triage?: TriageDeps;
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

  return app;
}
