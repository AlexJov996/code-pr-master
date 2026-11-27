import { matchesGlob } from "node:path";
import type { Config } from "../core/config.js";
import { BOT_NAME } from "../core/format.js";
import type { OctokitLike, PullRef } from "./pr.js";

export interface HandlerDeps {
  getOctokit: (installationId: number) => Promise<OctokitLike>;
  loadConfig: (octokit: OctokitLike, ref: PullRef & { ref: string }) => Promise<Config>;
  runReview: (octokit: OctokitLike, ref: PullRef, config: Config) => Promise<void>;
  /** Post a Change Stack walkthrough; optional so a review-only deployment still works. */
  runExplain?: (octokit: OctokitLike, ref: PullRef, config: Config) => Promise<void>;
  postComment: (octokit: OctokitLike, ref: PullRef, body: string) => Promise<void>;
  log?: (msg: string) => void;
}

const REVIEW_ACTIONS = new Set(["opened", "synchronize", "ready_for_review", "reopened"]);

interface PullRequestPayload {
  action: string;
  installation?: { id: number };
  repository: { name: string; owner: { login: string } };
  pull_request: { number: number; draft?: boolean; state?: string; head: { sha: string }; base: { ref: string } };
}

export async function handlePullRequest(payload: PullRequestPayload, deps: HandlerDeps): Promise<void> {
  const log = deps.log ?? (() => {});
  if (!REVIEW_ACTIONS.has(payload.action)) return;
  if (!payload.installation) { log("pull_request event without installation; ignoring"); return; }
  const ref: PullRef = { owner: payload.repository.owner.login, repo: payload.repository.name, number: payload.pull_request.number };
  const octokit = await deps.getOctokit(payload.installation.id);
  const config = await deps.loadConfig(octokit, { ...ref, ref: payload.pull_request.head.sha });
  const auto = config.reviews.auto_review;
  if (!auto.enabled) { log(`auto review disabled for ${ref.owner}/${ref.repo}#${ref.number}`); return; }
  if (payload.pull_request.draft && !auto.drafts) { log(`skipping draft ${ref.owner}/${ref.repo}#${ref.number}`); return; }
  if (auto.base_branches.length && !auto.base_branches.some((g) => matchesGlob(payload.pull_request.base.ref, g))) {
    log(`base ${payload.pull_request.base.ref} not in base_branches; skipping`);
    return;
  }
  await deps.runReview(octokit, ref, config);
}

export type Command = "review" | "explain" | "help" | "unknown";

/** Find `@carrot-review <command>` anywhere in a comment; undefined when the bot is not mentioned. */
export function parseCommand(body: string): Command | undefined {
  const m = body.match(new RegExp(`@${BOT_NAME}\\b\\s*([^\\n]*)`, "i"));
  if (!m) return undefined;
  const words = (m[1] ?? "").trim().toLowerCase();
  if (/^(full\s+)?review\b/.test(words) || words === "") return "review";
  if (/^explain\b/.test(words)) return "explain";
  if (/^help\b/.test(words)) return "help";
  return "unknown";
}

export function helpText(): string {
  return [
    `**${BOT_NAME} commands**`,
    "",
    `- \`@${BOT_NAME} review\`: review the latest commit of this pull request.`,
    `- \`@${BOT_NAME} explain\`: post a Change Stack walkthrough: layers, what to read first, and an architecture diagram.`,
    `- \`@${BOT_NAME} help\`: show this message.`,
    "",
    "Configure reviews with a `.carrot-review.yaml` at the repository root (profile, path filters, path instructions, tone).",
  ].join("\n");
}

interface IssueCommentPayload {
  action: string;
  installation?: { id: number };
  repository: { name: string; owner: { login: string } };
  issue: { number: number; pull_request?: unknown };
  comment: { body: string; user?: { type?: string; login?: string } };
}

export async function handleIssueComment(payload: IssueCommentPayload, deps: HandlerDeps): Promise<void> {
  if (payload.action !== "created") return;
  if (!payload.issue.pull_request) return;
  if (payload.comment.user?.type === "Bot") return;
  const command = parseCommand(payload.comment.body ?? "");
  if (!command || !payload.installation) return;
  const ref: PullRef = { owner: payload.repository.owner.login, repo: payload.repository.name, number: payload.issue.number };
  const octokit = await deps.getOctokit(payload.installation.id);
  if (command === "review" || command === "explain") {
    const config = await deps.loadConfig(octokit, { ...ref, ref: "HEAD" });
    if (command === "review") await deps.runReview(octokit, ref, config);
    else if (deps.runExplain) await deps.runExplain(octokit, ref, config);
    else await deps.postComment(octokit, ref, "The explain command is not enabled on this deployment.");
    return;
  }
  const body = command === "help" ? helpText() : `I did not recognise that command.\n\n${helpText()}`;
  await deps.postComment(octokit, ref, body);
}
