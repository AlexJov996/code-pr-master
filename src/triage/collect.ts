import type { Octokit } from "@octokit/rest";
import { parseCodeowners, suggestReviewers, type CodeownersRule } from "./codeowners.js";
import { scorePullRequest, type CiStatus, type IssueSeverity, type PullRequestSignals, type ReviewSignal } from "./score.js";
import type { TriageItem } from "./views.js";

export type TriageOctokit = Pick<Octokit, "pulls" | "repos" | "checks" | "issues">;

export interface RepoRef {
  owner: string;
  repo: string;
}

interface ListedPr {
  number: number;
  title: string;
  body?: string | null;
  draft?: boolean;
  html_url?: string;
  created_at: string;
  updated_at: string;
  base: { ref: string };
  head?: { sha: string };
  user?: { login: string; type?: string } | null;
  labels?: Array<{ name?: string }>;
  requested_reviewers?: Array<{ login?: string }> | null;
  requested_teams?: Array<{ slug?: string }> | null;
}

interface FileEntry { filename: string; additions: number; deletions: number }
interface ReviewEntry { user?: { login: string } | null; state: string; submitted_at?: string | null }

export interface ToSignalsInput {
  pr: ListedPr;
  files: FileEntry[];
  reviews: ReviewEntry[];
  ciStatus: CiStatus;
  repo: string;
  linkedIssueSeverity?: IssueSeverity;
}

const REVIEW_STATES = new Set(["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED", "PENDING"]);

export function toSignals(i: ToSignalsInput): PullRequestSignals {
  const author = i.pr.user?.login ?? "";
  const reviews: ReviewSignal[] = i.reviews
    .filter((r) => r.submitted_at && REVIEW_STATES.has(r.state))
    .map((r) => ({ author: r.user?.login ?? "", state: r.state as ReviewSignal["state"], submittedAt: new Date(r.submitted_at!) }));
  return {
    repo: i.repo,
    number: i.pr.number,
    title: i.pr.title,
    author,
    authorIsBot: i.pr.user?.type === "Bot" || /\[bot\]$/.test(author),
    isDraft: Boolean(i.pr.draft),
    createdAt: new Date(i.pr.created_at),
    updatedAt: new Date(i.pr.updated_at),
    baseRef: i.pr.base.ref,
    additions: i.files.reduce((n, f) => n + f.additions, 0),
    deletions: i.files.reduce((n, f) => n + f.deletions, 0),
    files: i.files.map((f) => f.filename),
    labels: (i.pr.labels ?? []).map((l) => l.name ?? "").filter(Boolean),
    requestedReviewers: [
      ...(i.pr.requested_reviewers ?? []).map((r) => r.login ?? "").filter(Boolean),
      ...(i.pr.requested_teams ?? []).map((t) => (t.slug ? `@${t.slug}` : "")).filter(Boolean),
    ],
    reviews,
    ciStatus: i.ciStatus,
    linkedIssueSeverity: i.linkedIssueSeverity,
    url: i.pr.html_url,
  };
}

const CODEOWNERS_PATHS = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];

async function loadCodeowners(octokit: TriageOctokit, ref: RepoRef): Promise<CodeownersRule[]> {
  for (const path of CODEOWNERS_PATHS) {
    try {
      const res = await octokit.repos.getContent({ ...ref, path });
      const data = res.data as { type?: string; content?: string; encoding?: string };
      if (data.type === "file" && typeof data.content === "string") {
        return parseCodeowners(Buffer.from(data.content, (data.encoding as BufferEncoding) || "base64").toString("utf8"));
      }
    } catch (err) {
      if ((err as { status?: number }).status !== 404) throw err;
    }
  }
  return [];
}

async function ciStatusFor(octokit: TriageOctokit, ref: RepoRef, sha: string): Promise<CiStatus> {
  if (!sha) return "none";
  let worst: CiStatus = "none";
  const bump = (s: CiStatus) => {
    const rank: Record<CiStatus, number> = { none: 0, success: 1, pending: 2, failure: 3 };
    if (rank[s] > rank[worst]) worst = s;
  };
  try {
    const checks = await octokit.checks.listForRef({ ...ref, ref: sha, per_page: 100 });
    for (const run of checks.data.check_runs) {
      if (run.status !== "completed") bump("pending");
      else if (run.conclusion === "success" || run.conclusion === "neutral" || run.conclusion === "skipped") bump("success");
      else bump("failure");
    }
  } catch (err) {
    if ((err as { status?: number }).status !== 403) throw err;
  }
  try {
    const combined = await octokit.repos.getCombinedStatusForRef({ ...ref, ref: sha });
    if (combined.data.statuses.length || combined.data.state !== "pending") {
      if (combined.data.state === "success") bump("success");
      else if (combined.data.state === "pending" && combined.data.statuses.length) bump("pending");
      else if (combined.data.state === "failure" || combined.data.state === "error") bump("failure");
    }
  } catch (err) {
    if ((err as { status?: number }).status !== 403) throw err;
  }
  return worst;
}

const SEVERITY_LABEL = /^(?:severity|sev|priority)?[:\s-]*(critical|high|medium|low|[0-3])$/i;

function severityFromLabels(labels: Array<{ name?: string } | string>): IssueSeverity | undefined {
  for (const l of labels) {
    const name = (typeof l === "string" ? l : l.name ?? "").trim();
    const m = name.match(SEVERITY_LABEL);
    if (!m) continue;
    const v = m[1]!.toLowerCase();
    if (v === "critical" || v === "0") return "Critical";
    if (v === "high" || v === "1") return "High";
    if (v === "medium" || v === "2") return "Medium";
    return "Low";
  }
  return undefined;
}

async function linkedIssueSeverity(octokit: TriageOctokit, ref: RepoRef, body: string | null | undefined): Promise<IssueSeverity | undefined> {
  const m = (body ?? "").match(/\b(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?)\s+#(\d+)/i);
  if (!m) return undefined;
  try {
    const issue = await octokit.issues.get({ ...ref, issue_number: Number(m[1]) });
    return severityFromLabels(issue.data.labels as Array<{ name?: string } | string>);
  } catch {
    return undefined;
  }
}

export interface CollectOptions {
  now?: Date;
}

/** Open pull requests of one repository, scored and routed. */
export async function collectPullRequests(octokit: TriageOctokit, ref: RepoRef, opts: CollectOptions = {}): Promise<TriageItem[]> {
  const repo = `${ref.owner}/${ref.repo}`;
  const [listed, codeowners] = await Promise.all([
    octokit.pulls.list({ ...ref, state: "open", per_page: 100, sort: "updated", direction: "desc" }),
    loadCodeowners(octokit, ref),
  ]);

  const items: TriageItem[] = [];
  for (const pr of listed.data as unknown as ListedPr[]) {
    const [files, reviews, ciStatus, severity] = await Promise.all([
      octokit.pulls.listFiles({ ...ref, pull_number: pr.number, per_page: 100 }),
      octokit.pulls.listReviews({ ...ref, pull_number: pr.number, per_page: 100 }),
      ciStatusFor(octokit, ref, pr.head?.sha ?? ""),
      linkedIssueSeverity(octokit, ref, pr.body),
    ]);
    const signals = toSignals({ pr, files: files.data as FileEntry[], reviews: reviews.data as ReviewEntry[], ciStatus, repo, linkedIssueSeverity: severity });
    const assessment = scorePullRequest(signals, { now: opts.now });
    assessment.suggestedReviewers = suggestReviewers(signals.files, codeowners, { exclude: [signals.author, ...signals.requestedReviewers] });
    items.push({ signals, assessment });
  }
  return items.sort((a, b) => b.assessment.score - a.assessment.score || a.signals.number - b.signals.number);
}
