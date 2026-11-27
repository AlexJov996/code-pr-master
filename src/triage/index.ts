import { Octokit } from "@octokit/rest";
import { createDefaultClient, createStructuredGenerate } from "../core/claude.js";
import type { Config } from "../core/config.js";
import { enrichItems, TriageAiOutputSchema } from "./assess.js";
import { collectPullRequests } from "./collect.js";
import { demoItems } from "./demo.js";
import { savedViewFromConfig, type SavedView, type TriageItem } from "./views.js";

export interface LoaderOptions {
  /** GitHub token (PAT or installation token). Ignored in demo mode. */
  token?: string;
  /** Serve fictional data instead of calling GitHub. */
  demo?: boolean;
  config: Config;
  /** Run the Claude value/risk assessment on top of the heuristics. Needs an Anthropic credential. */
  ai?: boolean;
  cacheMs?: number;
  log?: (msg: string) => void;
}

export type TriageLoader = (repo: string) => Promise<TriageItem[]>;

/** Build the "owner/name" → scored items function used by the server and the CLI, with a small per-repo cache. */
export function createTriageLoader(opts: LoaderOptions): TriageLoader {
  const log = opts.log ?? (() => {});
  const cache = new Map<string, { at: number; items: TriageItem[] }>();
  const ttl = opts.cacheMs ?? 60_000;
  const octokit = opts.demo ? undefined : new Octokit({ auth: opts.token });
  const generate = opts.ai ? createStructuredGenerate(createDefaultClient(), { model: opts.config.model, effort: "low", maxTokens: 2000 }, TriageAiOutputSchema) : undefined;

  return async (repo) => {
    const hit = cache.get(repo);
    if (hit && Date.now() - hit.at < ttl) return hit.items;
    let items: TriageItem[];
    if (opts.demo || !octokit) {
      items = demoItems();
    } else {
      const [owner, name] = repo.split("/");
      items = await collectPullRequests(octokit, { owner: owner!, repo: name! });
      log(`${repo}: collected ${items.length} open pull requests`);
    }
    if (generate) {
      items = await enrichItems(items, generate, { onError: (item, err) => log(`${repo}#${item.signals.number}: assessment failed: ${err instanceof Error ? err.message : String(err)}`) });
    }
    cache.set(repo, { at: Date.now(), items });
    return items;
  };
}

export function savedViewsFrom(config: Config): SavedView[] {
  return config.triage.saved_views.map(savedViewFromConfig);
}
