import type { Octokit } from "@octokit/rest";
import { CONFIG_FILENAMES, DEFAULT_CONFIG, parseConfig, type Config } from "../core/config.js";
import { renderInlineComment, renderSummaryComment, SUMMARY_MARKER } from "../core/format.js";
import type { ReviewResult } from "../core/schema.js";

/** The slice of Octokit this module calls; tests pass a stub. */
export type OctokitLike = Pick<Octokit, "pulls" | "issues" | "repos">;

export interface PullRef {
  owner: string;
  repo: string;
  number: number;
}

export interface PullRequestData extends PullRef {
  title: string;
  description: string;
  diff: string;
  headSha: string;
  baseRef: string;
  isDraft: boolean;
  author: string;
  state: string;
}

export async function fetchPullRequest(octokit: OctokitLike, ref: PullRef): Promise<PullRequestData> {
  const params = { owner: ref.owner, repo: ref.repo, pull_number: ref.number };
  const [meta, diff] = await Promise.all([
    octokit.pulls.get(params),
    octokit.pulls.get({ ...params, mediaType: { format: "diff" } }),
  ]);
  const pr = meta.data;
  return {
    ...ref,
    title: pr.title ?? "",
    description: pr.body ?? "",
    diff: diff.data as unknown as string,
    headSha: pr.head.sha,
    baseRef: pr.base.ref,
    isDraft: Boolean(pr.draft),
    author: pr.user?.login ?? "",
    state: pr.state,
  };
}

/** Read `.carrot-review.yaml` (or `.yml`) at the given ref; missing file means defaults. */
export async function loadRepoConfig(octokit: OctokitLike, ref: PullRef & { ref: string }): Promise<Config> {
  for (const path of CONFIG_FILENAMES) {
    try {
      const res = await octokit.repos.getContent({ owner: ref.owner, repo: ref.repo, path, ref: ref.ref });
      const data = res.data as { type?: string; content?: string; encoding?: string };
      if (data.type === "file" && typeof data.content === "string") {
        const text = Buffer.from(data.content, (data.encoding as BufferEncoding) || "base64").toString("utf8");
        return parseConfig(text);
      }
    } catch (err) {
      if ((err as { status?: number }).status !== 404) throw err;
    }
  }
  return DEFAULT_CONFIG;
}

/** Create or update the sticky summary comment; returns its id so later edits need no second lookup. */
async function upsertSummary(octokit: OctokitLike, ref: PullRef, body: string, knownId?: number): Promise<number> {
  const params = { owner: ref.owner, repo: ref.repo, issue_number: ref.number };
  let id = knownId;
  if (id === undefined) {
    const existing = await octokit.issues.listComments({ ...params, per_page: 100 });
    id = existing.data.find((c) => typeof c.body === "string" && c.body.startsWith(SUMMARY_MARKER))?.id;
  }
  if (id !== undefined) {
    await octokit.issues.updateComment({ owner: ref.owner, repo: ref.repo, comment_id: id, body });
    return id;
  }
  const created = await octokit.issues.createComment({ ...params, body });
  return created.data.id;
}

/** Post the sticky summary and the inline review. Falls back to summary-only if GitHub rejects the inline anchors. */
export async function publishReview(octokit: OctokitLike, pr: PullRef & { headSha: string }, result: ReviewResult): Promise<void> {
  const summaryId = await upsertSummary(octokit, pr, renderSummaryComment(result));
  if (result.findings.length === 0) return;

  const comments = result.findings.map((f) => {
    const base = { path: f.path, line: f.end_line && f.end_line > f.line ? f.end_line : f.line, side: "RIGHT" as const, body: renderInlineComment(f) };
    return f.end_line && f.end_line > f.line ? { ...base, start_line: f.line, start_side: "RIGHT" as const } : base;
  });

  try {
    await octokit.pulls.createReview({
      owner: pr.owner, repo: pr.repo, pull_number: pr.number,
      commit_id: pr.headSha,
      event: "COMMENT",
      body: `${result.findings.length} inline finding${result.findings.length === 1 ? "" : "s"} from carrot-review.`,
      comments,
    });
  } catch (err) {
    if ((err as { status?: number }).status !== 422) throw err;
    const fallback: ReviewResult = { ...result, findings: [], generalComments: [...result.findings, ...result.generalComments] };
    await upsertSummary(octokit, pr, renderSummaryComment(fallback), summaryId);
  }
}
