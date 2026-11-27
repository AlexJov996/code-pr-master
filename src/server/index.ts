import { existsSync, readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { CONFIG_FILENAMES, DEFAULT_CONFIG, parseConfig } from "../core/config.js";
import { createHandlerDeps } from "../github/app.js";
import { handleIssueComment, handlePullRequest } from "../github/handlers.js";
import { createTriageLoader, savedViewsFrom } from "../triage/index.js";
import { Octokit } from "@octokit/rest";
import { createDefaultClient, createStructuredGenerate, hasAnthropicCredential } from "../core/claude.js";
import { fetchPullRequest } from "../github/pr.js";
import { DEMO_EXPLAIN_INPUT } from "../understand/demo.js";
import { ChangeStackOutputSchema } from "../understand/schema.js";
import { createApp, type ExplainDeps, type TriageDeps } from "./app.js";

const log = (m: string) => console.log(`[carrot-review] ${m}`);

function required(name: string): string {
  const v = process.env[name];
  if (!v) { console.error(`Missing required environment variable ${name}`); process.exit(1); }
  return v;
}

const localConfig = (() => {
  for (const name of CONFIG_FILENAMES) if (existsSync(name)) return parseConfig(readFileSync(name, "utf8"));
  return DEFAULT_CONFIG;
})();

// Review bot: needs the GitHub App credentials. Skipped (with a warning) when they are absent so the Triage board can run alone.
const hasApp = Boolean(process.env.GITHUB_APP_ID && process.env.GITHUB_PRIVATE_KEY && process.env.GITHUB_WEBHOOK_SECRET);
const deps = hasApp
  ? createHandlerDeps(
      { appId: required("GITHUB_APP_ID"), privateKey: required("GITHUB_PRIVATE_KEY").replace(/\\n/g, "\n") },
      { modelOverride: process.env.CARROT_MODEL, log },
    )
  : undefined;
if (!deps) log("GitHub App credentials not set; the webhook endpoint will reject every delivery.");

// Triage board and Explain page: a user token (GITHUB_TOKEN) or demo mode (CARROT_DEMO=1).
const demo = process.env.CARROT_DEMO === "1" || process.env.CARROT_TRIAGE_DEMO === "1";
const triage: TriageDeps | undefined = demo || process.env.GITHUB_TOKEN
  ? {
      load: createTriageLoader({ token: process.env.GITHUB_TOKEN, demo, config: localConfig, ai: localConfig.triage.ai_assessment && Boolean(process.env.ANTHROPIC_API_KEY), log }),
      me: process.env.CARROT_ME,
      savedViews: savedViewsFrom(localConfig),
    }
  : undefined;
if (!triage) log("Set GITHUB_TOKEN (or CARROT_DEMO=1) to enable the Triage board at /triage and the Explain page at /explain.");

const explain: ExplainDeps | undefined = demo || process.env.GITHUB_TOKEN
  ? {
      load: demo
        ? async () => DEMO_EXPLAIN_INPUT
        : async (repo, number) => {
            const [owner, name] = repo.split("/");
            const pr = await fetchPullRequest(new Octokit({ auth: process.env.GITHUB_TOKEN }), { owner: owner!, repo: name!, number });
            return { title: pr.title, description: pr.description, diff: pr.diff };
          },
      generate: hasAnthropicCredential() ? createStructuredGenerate(createDefaultClient(), { model: process.env.CARROT_MODEL ?? localConfig.model }, ChangeStackOutputSchema) : undefined,
    }
  : undefined;

const app = createApp({
  webhookSecret: process.env.GITHUB_WEBHOOK_SECRET ?? "unset",
  onPullRequest: (p) => (deps ? handlePullRequest(p, deps) : Promise.resolve()),
  onIssueComment: (p) => (deps ? handleIssueComment(p, deps) : Promise.resolve()),
  triage,
  explain,
  log: (m) => console.error(`[carrot-review] ${m}`),
});

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, (info) => {
  log(`listening on http://localhost:${info.port} (webhook: POST /api/webhooks/github${triage ? `, board: GET /triage?repo=owner/name, explain: GET /explain?repo=owner/name&pr=N${demo ? " [demo data]" : ""}` : ""})`);
});
