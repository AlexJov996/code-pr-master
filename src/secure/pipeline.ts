import type { StructuredGenerate } from "../core/claude.js";
import type { Config } from "../core/config.js";
import { fetchPullRequest, upsertMarkedComment, type OctokitLike, type PullRef, type PullRequestData } from "../github/pr.js";
import { draftFix, openFixPullRequest, type FixOctokit } from "./fix.js";
import { renderFindingMarkdown, renderScanMarkdown, SECURITY_MARKER } from "./posture.js";
import { scanDiff, scanFiles, type ScanDeps, type ScanFile } from "./scan.js";
import type { FixOutput, HuntOutput, ScanResult } from "./schema.js";
import type { VerifyFinding } from "./verify.js";

export interface SecurityDeps {
  hunt?: StructuredGenerate<HuntOutput>;
  verify?: VerifyFinding;
  fix?: StructuredGenerate<FixOutput>;
  log?: (msg: string) => void;
}

function scanDeps(config: Config, deps: SecurityDeps): ScanDeps {
  return { hunt: deps.hunt, verify: deps.verify, minSeverity: config.security.min_severity, onError: (f, err) => deps.log?.(`verify failed for ${f.path}:${f.line}: ${err instanceof Error ? err.message : String(err)}`) };
}

async function readFileAt(octokit: OctokitLike, ref: PullRef, path: string, gitRef: string): Promise<string | undefined> {
  try {
    const res = await octokit.repos.getContent({ owner: ref.owner, repo: ref.repo, path, ref: gitRef });
    const data = res.data as { type?: string; content?: string; encoding?: string };
    if (data.type !== "file" || typeof data.content !== "string") return undefined;
    return Buffer.from(data.content, (data.encoding as BufferEncoding) || "base64").toString("utf8");
  } catch {
    return undefined;
  }
}

/** Draft and open fix PRs for confirmed Critical and High findings, targeting the pull request's branch. */
async function autoFix(octokit: OctokitLike & FixOctokit, ref: PullRef, pr: PullRequestData, result: ScanResult, deps: SecurityDeps): Promise<void> {
  const log = deps.log ?? (() => {});
  for (const f of result.findings) {
    if (f.verification.verdict !== "Confirmed" || (f.severity !== "Critical" && f.severity !== "High")) continue;
    const content = await readFileAt(octokit, ref, f.path, pr.headRef);
    if (content === undefined) { log(`auto-fix: cannot read ${f.path} at ${pr.headRef}`); continue; }
    try {
      const fix = await draftFix(f, content, deps.fix!);
      const opened = await openFixPullRequest(octokit, { owner: ref.owner, repo: ref.repo, baseBranch: pr.headRef }, f, fix);
      f.fix = { description: fix.description, diff: fix.diff, branch: opened.branch, pullRequestUrl: opened.url };
      log(`auto-fix: opened ${opened.url} for ${f.path}:${f.line}`);
    } catch (err) {
      log(`auto-fix failed for ${f.path}:${f.line}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export interface PullRequestScanOutcome {
  result: ScanResult;
  pr: PullRequestData;
}

/** PR scan: diff → Map/Hunt/Verify → optional auto-fix → sticky comment + inline review. */
export async function runPullRequestScan(octokit: OctokitLike & Partial<FixOctokit>, ref: PullRef, config: Config, deps: SecurityDeps): Promise<PullRequestScanOutcome> {
  const pr = await fetchPullRequest(octokit, ref);
  const result = await scanDiff(pr.diff, scanDeps(config, deps));
  if (config.security.auto_fix && deps.fix && "git" in octokit && octokit.git) await autoFix(octokit as OctokitLike & FixOctokit, ref, pr, result, deps);

  await upsertMarkedComment(octokit, ref, SECURITY_MARKER, renderScanMarkdown(result, { repo: `${ref.owner}/${ref.repo}` }));
  if (result.findings.length) {
    try {
      await octokit.pulls.createReview({
        owner: ref.owner, repo: ref.repo, pull_number: ref.number, commit_id: pr.headSha, event: "COMMENT",
        body: `${result.findings.length} security finding${result.findings.length === 1 ? "" : "s"} from carrot-review Secure.`,
        comments: result.findings.map((f) => ({ path: f.path, line: f.line, side: "RIGHT" as const, body: `🔒 ${renderFindingMarkdown(f)}` })),
      });
    } catch (err) {
      if ((err as { status?: number }).status !== 422) throw err;
      deps.log?.(`inline security comments rejected by GitHub; the summary comment has them`);
    }
  }
  return { result, pr };
}

/** Deep scan over a set of files (a local checkout, or anything else already read). */
export async function runDeepScan(files: readonly ScanFile[], config: Config, deps: SecurityDeps): Promise<ScanResult> {
  return scanFiles(files, scanDeps(config, deps), "files");
}
