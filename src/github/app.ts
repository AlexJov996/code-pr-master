import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { createClaudeGenerate, createDefaultClient } from "../core/claude.js";
import type { Config } from "../core/config.js";
import { reviewChanges, type Generate } from "../core/review.js";
import type { HandlerDeps } from "./handlers.js";
import { fetchPullRequest, loadRepoConfig, publishReview, type OctokitLike, type PullRef } from "./pr.js";

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
    postComment: createPostComment(),
    log: opts.log,
  };
}
