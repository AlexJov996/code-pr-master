import { serve } from "@hono/node-server";
import { createHandlerDeps } from "../github/app.js";
import { handleIssueComment, handlePullRequest } from "../github/handlers.js";
import { createApp } from "./app.js";

function required(name: string): string {
  const v = process.env[name];
  if (!v) { console.error(`Missing required environment variable ${name}`); process.exit(1); }
  return v;
}

const deps = createHandlerDeps(
  { appId: required("GITHUB_APP_ID"), privateKey: required("GITHUB_PRIVATE_KEY").replace(/\\n/g, "\n") },
  { modelOverride: process.env.CARROT_MODEL, log: (m) => console.log(`[carrot-review] ${m}`) },
);

const app = createApp({
  webhookSecret: required("GITHUB_WEBHOOK_SECRET"),
  onPullRequest: (p) => handlePullRequest(p, deps),
  onIssueComment: (p) => handleIssueComment(p, deps),
  log: (m) => console.error(`[carrot-review] ${m}`),
});

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[carrot-review] listening on http://localhost:${info.port} (webhook: POST /api/webhooks/github)`);
});
