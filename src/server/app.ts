import { Webhooks } from "@octokit/webhooks";
import { Hono } from "hono";

export interface ServerDeps {
  webhookSecret: string;
  onPullRequest: (payload: any) => Promise<void>;
  onIssueComment: (payload: any) => Promise<void>;
  log?: (msg: string) => void;
}

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

  return app;
}
