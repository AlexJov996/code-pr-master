import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { createClaudeGenerate, createDefaultClient, createStructuredGenerate, hasAnthropicCredential } from "../core/claude.js";
import { explainChanges } from "../understand/explain.js";
import { EXPLAIN_MARKER, renderExplainMarkdown } from "../understand/render.js";
import { ChangeStackOutputSchema } from "../understand/schema.js";
import { runPullRequestScan } from "../secure/pipeline.js";
import { createSecurityDeps } from "../secure/index.js";
import { runPullRequestVerify } from "../verify/pipeline.js";
import type { Config } from "../core/config.js";
import { reviewChanges, type Generate } from "../core/review.js";
import type { HandlerDeps } from "./handlers.js";
import { fetchPullRequest, loadRepoConfig, publishReview, upsertMarkedComment, type OctokitLike, type PullRef } from "./pr.js";

export interface AppCredentials {
  appId: string;
  privateKey: string;
}

export function createInstallationOctokit(creds: AppCredentials): HandlerDeps["getOctokit"] {
  return async (installationId) =>
    new Octokit({ authStrategy: createAppAuth, auth: { appId: creds.appId, privateKey: creds.privateKey, installationId } });
}

export interface PipelineOptions {
  /** Build the model call for a given config; defaults to the Anthropic SDK with the config's model. */
  generateFor?: (config: Config) => Generate;
  modelOverride?: string;
  log?: (msg: string) => void;
  /** Where Verify stores runs and evidence. */
  runsDir?: string;
  /** Public URL of this server, used to link run pages from comments. */
  serverUrl?: string;
}

/** fetch → review → publish, the whole bot in one function. */
export function createRunReview(opts: PipelineOptions = {}): HandlerDeps["runReview"] {
  const log = opts.log ?? ((m) => console.log(m));
  const generateFor = opts.generateFor ?? ((config: Config) => createClaudeGenerate(createDefaultClient(), { model: opts.modelOverride ?? config.model }));
  return async (octokit: OctokitLike, ref: PullRef, config: Config) => {
    const label = `${ref.owner}/${ref.repo}#${ref.number}`;
    const started = Date.now();
    const pr = await fetchPullRequest(octokit, ref);
    if (pr.state !== "open") { log(`${label} is ${pr.state}; skipping`); return; }
    const effective = opts.modelOverride ? { ...config, model: opts.modelOverride } : config;
    log(`${label}: reviewing ${pr.headSha.slice(0, 7)} with ${effective.model} (${effective.reviews.profile})`);
    const result = await reviewChanges({ title: pr.title, description: pr.description, diff: pr.diff, config: effective }, { generate: generateFor(effective) });
    await publishReview(octokit, pr, result);
    log(`${label}: posted ${result.findings.length} inline + ${result.generalComments.length} general findings in ${Math.round((Date.now() - started) / 1000)}s`);
  };
}

/** fetch → explain → post (or update) the Change Stack comment. Uses the model when a credential exists, else the heuristic walkthrough. */
export function createRunExplain(opts: PipelineOptions = {}): NonNullable<HandlerDeps["runExplain"]> {
  const log = opts.log ?? ((m) => console.log(m));
  return async (octokit, ref, config) => {
    const label = `${ref.owner}/${ref.repo}#${ref.number}`;
    const pr = await fetchPullRequest(octokit, ref);
    const model = opts.modelOverride ?? config.model;
    const generate = hasAnthropicCredential() ? createStructuredGenerate(createDefaultClient(), { model }, ChangeStackOutputSchema) : undefined;
    log(`${label}: explaining ${pr.headSha.slice(0, 7)} (${generate ? model : "heuristic"})`);
    const result = await explainChanges({ title: pr.title, description: pr.description, diff: pr.diff }, { generate });
    await upsertMarkedComment(octokit, ref, EXPLAIN_MARKER, renderExplainMarkdown(result));
    log(`${label}: posted a ${result.stack.layers.length}-layer walkthrough`);
  };
}

/** PR security scan: Map/Hunt/Verify over the diff, optional auto-fix, sticky comment and inline findings. */
export function createRunScan(opts: PipelineOptions = {}): NonNullable<HandlerDeps["runScan"]> {
  const log = opts.log ?? ((m) => console.log(m));
  return async (octokit, ref, config) => {
    const label = `${ref.owner}/${ref.repo}#${ref.number}`;
    const deps = createSecurityDeps({ model: opts.modelOverride ?? config.model, log });
    const { result } = await runPullRequestScan(octokit as any, ref, config, deps);
    log(`${label}: security scan posted ${result.findings.length} finding${result.findings.length === 1 ? "" : "s"} (${result.rejected.length} rejected)`);
  };
}

/** Agentic QA on a pull request: journeys from the saved file plus generated scenarios, run against config.verify.base_url. */
export function createRunVerify(opts: PipelineOptions = {}): NonNullable<HandlerDeps["runVerify"]> {
  const log = opts.log ?? ((m) => console.log(m));
  return async (octokit, ref, config) => {
    const { run } = await runPullRequestVerify(octokit, ref, config, { model: opts.modelOverride ?? config.model, runsDir: opts.runsDir ?? ".carrot-review/verify", serverUrl: opts.serverUrl, log });
    if (run) log(`${ref.owner}/${ref.repo}#${ref.number}: verify ${run.summary.failed} bug(s), ${run.summary.passed} passed`);
  };
}

export function createPostComment(): HandlerDeps["postComment"] {
  return async (octokit, ref, body) => {
    await octokit.issues.createComment({ owner: ref.owner, repo: ref.repo, issue_number: ref.number, body });
  };
}

export function createHandlerDeps(creds: AppCredentials, opts: PipelineOptions = {}): HandlerDeps {
  return {
    getOctokit: createInstallationOctokit(creds),
    loadConfig: loadRepoConfig,
    runReview: createRunReview(opts),
    runExplain: createRunExplain(opts),
    runScan: createRunScan(opts),
    runVerify: createRunVerify(opts),
    postComment: createPostComment(),
    log: opts.log,
  };
}
