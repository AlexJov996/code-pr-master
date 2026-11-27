export type Level = "Low" | "Medium" | "High";
export type Priority = "P0" | "P1" | "P2" | "P3";
export type ReviewDepth = "Quick review" | "Standard review" | "Deep review" | "Review later";
export type NextAction =
  | "Needs human review"
  | "Needs author action"
  | "Safe to merge"
  | "Reviewer assigned; waiting for review";
export type CiStatus = "success" | "failure" | "pending" | "none";
export type IssueSeverity = "Low" | "Medium" | "High" | "Critical";

export interface ReviewSignal {
  author: string;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING";
  submittedAt: Date;
}

/** Everything the scorer needs about one open pull request. Collected from GitHub or supplied by hand. */
export interface PullRequestSignals {
  repo: string;
  number: number;
  title: string;
  author: string;
  authorIsBot: boolean;
  isDraft: boolean;
  createdAt: Date;
  updatedAt: Date;
  baseRef: string;
  additions: number;
  deletions: number;
  files: string[];
  labels: string[];
  requestedReviewers: string[];
  reviews: ReviewSignal[];
  ciStatus: CiStatus;
  linkedIssueSeverity?: IssueSeverity;
  url?: string;
  authorName?: string;
}

export interface TriageAssessment {
  priority: Priority;
  priorityLabel: string;
  risk: Level;
  reviewDepth: ReviewDepth;
  complexity: Level;
  effort: Level;
  blastRadius: Level;
  nextAction: NextAction;
  tags: string[];
  why: string;
  /** 0 to 100; higher sorts first. */
  score: number;
  suggestedReviewers: string[];
}

export const PRIORITY_LABEL: Record<Priority, string> = {
  P0: "Urgent", P1: "High priority", P2: "Medium priority", P3: "Low priority",
};

/** Code where a mistake is a security incident: urgent when touched. */
const CRITICAL_PATH = /(^|\/)(auth[a-z]*|security|secrets?|crypto|credentials?|oauth|sso|signing)(\/|\.|-|_|$)/i;
/** Code where a mistake is expensive but not an immediate breach: high risk, high priority. */
const SENSITIVE_PATH = /(^|\/)(payments?|billing|iam|permissions?|infra|terraform|k8s|kubernetes|helm|deploy|migrations?|\.github\/workflows|dockerfile|docker-compose)(\/|\.|$)|\.(tf)$/i;
/** Titles that hint at secrets handling; raise risk to Medium when the paths alone look harmless. */
const RISKY_TITLE = /\b(signing key|secret|credential|password|vulnerab|cve|security fix)\b/i;
const SHARED_PATH = /(^|\/)(packages\/core|core|shared|lib|common|platform|sdk)(\/|$)/i;
const DOCS_PATH = /(^|\/)docs?\/|\.(md|mdx|rst|txt|adoc)$/i;
const BOT_AUTHOR = /\[bot\]$|(^|-)(bot|agent)$/i;

const LEVEL_RANK: Record<Level, number> = { Low: 0, Medium: 1, High: 2 };
const maxLevel = (a: Level, b: Level): Level => (LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b);

function days(from: Date, to: Date): number {
  return Math.max(0, (to.getTime() - from.getTime()) / 86_400_000);
}

function latestReviewPerAuthor(reviews: ReviewSignal[]): ReviewSignal[] {
  const latest = new Map<string, ReviewSignal>();
  for (const r of [...reviews].sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime())) {
    if (r.state === "COMMENTED" || r.state === "PENDING") continue; // comments do not change approval state
    latest.set(r.author, r);
  }
  return [...latest.values()];
}

export interface ScoreOptions {
  now?: Date;
}

export function scorePullRequest(pr: PullRequestSignals, opts: ScoreOptions = {}): TriageAssessment {
  const now = opts.now ?? new Date();
  const lines = pr.additions + pr.deletions;
  const files = pr.files;
  const labels = pr.labels.map((l) => l.toLowerCase());
  const docsOnly = files.length > 0 && files.every((f) => DOCS_PATH.test(f));
  const critical = !docsOnly && (files.some((f) => CRITICAL_PATH.test(f)) || labels.includes("security"));
  const sensitive = !docsOnly && files.some((f) => SENSITIVE_PATH.test(f));
  const riskyTitle = !docsOnly && RISKY_TITLE.test(pr.title);
  const agentCreated = pr.authorIsBot || BOT_AUTHOR.test(pr.author) || labels.some((l) => /^(agent|ai-generated|agent-created)$/.test(l));

  // Spread across the repository.
  const areas = new Set(files.map((f) => (f.includes("/") ? f.split("/")[0]! : "(root)")));
  const touchesShared = files.some((f) => SHARED_PATH.test(f));
  const blastRadius: Level =
    areas.size >= 3 || touchesShared || files.length >= 15 ? "High" : areas.size === 2 || files.length >= 6 ? "Medium" : "Low";

  // Risk.
  let risk: Level = "Low";
  if (critical || sensitive) risk = "High";
  else if (riskyTitle || (!docsOnly && (lines > 300 || files.length >= 4 || blastRadius === "High"))) risk = "Medium";

  // Complexity and effort.
  let complexity: Level = docsOnly ? "Low" : lines > 500 ? "High" : lines > 150 ? "Medium" : "Low";
  if (!docsOnly && files.length >= 10) complexity = maxLevel(complexity, "Medium");
  const effort: Level = lines > 400 ? "High" : lines > 100 ? "Medium" : "Low";

  // Review depth.
  let reviewDepth: ReviewDepth;
  if (pr.isDraft) reviewDepth = "Review later";
  else if (risk === "High") reviewDepth = "Deep review";
  else if (risk === "Medium" || complexity === "High") reviewDepth = "Standard review";
  else reviewDepth = "Quick review";

  // Next action.
  const latest = latestReviewPerAuthor(pr.reviews);
  const changesRequested = latest.some((r) => r.state === "CHANGES_REQUESTED");
  const approved = !changesRequested && latest.some((r) => r.state === "APPROVED");
  let nextAction: NextAction;
  if (pr.isDraft || pr.ciStatus === "failure" || changesRequested) nextAction = "Needs author action";
  else if (approved && pr.ciStatus === "success" && risk === "Low") nextAction = "Safe to merge";
  else if (approved) nextAction = "Needs human review";
  else if (pr.requestedReviewers.length > 0 && pr.reviews.length === 0) nextAction = "Reviewer assigned; waiting for review";
  else nextAction = "Needs human review";

  // Tags.
  const tags: string[] = [];
  if (agentCreated) tags.push("Agent-created");
  if (/^fix(\(|:|!)/i.test(pr.title) || labels.some((l) => /^bug(fix)?$/.test(l))) tags.push("Bugfix");
  const lastReview = pr.reviews.reduce<Date | undefined>((m, r) => (!m || r.submittedAt > m ? r.submittedAt : m), undefined);
  if (lastReview && pr.updatedAt > lastReview) tags.push("New changes since last review");
  if (pr.linkedIssueSeverity) tags.push(`Issue severity: ${pr.linkedIssueSeverity}`);

  // Priority.
  const urgentLabel = labels.some((l) => /^(hotfix|urgent|p0|sev-?[01]|incident)$/.test(l));
  const forcedUrgent = urgentLabel || pr.linkedIssueSeverity === "Critical";
  let priority: Priority;
  if (forcedUrgent || (risk === "High" && (critical || agentCreated))) priority = "P0";
  else if (risk === "High" || (risk === "Medium" && blastRadius === "High") || pr.linkedIssueSeverity === "High" || (agentCreated && blastRadius === "High")) priority = "P1";
  else if (docsOnly) priority = "P3";
  else priority = "P2";
  // A reviewer cannot act on a draft or on work the author still owns, so those never rank as urgent.
  if (!forcedUrgent) {
    if (pr.isDraft && priority < "P2") priority = "P2";
    else if (nextAction === "Needs author action" && priority < "P1") priority = "P1";
  }

  // Why.
  const waitingDays = days(pr.updatedAt, now);
  let why: string;
  if (agentCreated && risk === "High") why = critical
    ? "Agent-created change touches security-sensitive code. Human judgment required."
    : "Agent-created change touches high-risk code. Human judgment required.";
  else if (nextAction === "Safe to merge") why = "Approved with green checks. Safe to merge.";
  else if (nextAction === "Reviewer assigned; waiting for review") why = waitingDays > 3 ? "Review has been waiting and may need coordination." : "Reviewer assigned; waiting for review.";
  else if (nextAction === "Needs author action") why = pr.isDraft ? "Draft; the author is still working on it." : waitingDays > 3 ? "This may need maintainer follow-up." : "Waiting on the author to address feedback or fix checks.";
  else if (pr.requestedReviewers.length === 0 && pr.reviews.length === 0 && waitingDays >= 1) why = "Assign a reviewer to keep this moving.";
  else if (waitingDays > 3) why = "Review has been waiting and may need coordination.";
  else if (approved) why = "Approved, but the risk level calls for a second look.";
  else why = "New, active work needs your attention.";

  // Score for ranking.
  const base: Record<Priority, number> = { P0: 90, P1: 70, P2: 50, P3: 30 };
  let score = base[priority] + LEVEL_RANK[risk] * 2.5 + LEVEL_RANK[blastRadius] * 1.5 + Math.min(waitingDays, 5) + (agentCreated ? 2 : 0);
  if (nextAction === "Safe to merge") score -= 10;
  if (pr.isDraft) score -= 15;
  score = Math.max(0, Math.min(100, Math.round(score * 10) / 10));

  return { priority, priorityLabel: PRIORITY_LABEL[priority], risk, reviewDepth, complexity, effort, blastRadius, nextAction, tags, why, score, suggestedReviewers: [] };
}
