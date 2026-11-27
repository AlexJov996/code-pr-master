import { describe, expect, test } from "vitest";
import { collectPullRequests, toSignals } from "../../src/triage/collect.js";

const listed = {
  number: 7, title: "fix(auth): rotate key", draft: false, html_url: "https://github.com/acme/platform/pull/7",
  created_at: "2026-11-20T10:00:00Z", updated_at: "2026-11-26T10:00:00Z", base: { ref: "main" }, head: { sha: "abc123" },
  user: { login: "sentinel-agent[bot]", type: "Bot" },
  labels: [{ name: "security" }], requested_reviewers: [{ login: "sam" }], requested_teams: [{ slug: "sec" }],
  body: "Fixes #12",
};

function stub(calls: Record<string, any[]> = {}) {
  const rec = (name: string, impl: (p: any) => any) => async (p: any) => { (calls[name] ??= []).push(p); return impl(p); };
  return {
    pulls: {
      list: rec("pulls.list", () => ({ data: [listed] })),
      listFiles: rec("pulls.listFiles", () => ({ data: [{ filename: "auth/keys.ts", additions: 10, deletions: 2 }, { filename: "README.md", additions: 1, deletions: 0 }] })),
      listReviews: rec("pulls.listReviews", () => ({ data: [{ user: { login: "sam" }, state: "APPROVED", submitted_at: "2026-11-25T10:00:00Z" }] })),
    },
    checks: { listForRef: rec("checks.listForRef", () => ({ data: { check_runs: [{ status: "completed", conclusion: "success" }, { status: "completed", conclusion: "failure" }] } })) },
    repos: {
      getCombinedStatusForRef: rec("repos.getCombinedStatusForRef", () => ({ data: { state: "success", statuses: [] } })),
      getContent: rec("repos.getContent", () => ({ data: { type: "file", encoding: "base64", content: Buffer.from("auth/ @security-lead\n").toString("base64") } })),
    },
    issues: { get: rec("issues.get", () => ({ data: { labels: [{ name: "severity: high" }] } })) },
  } as any;
}

describe("toSignals", () => {
  test("maps GitHub shapes into scorer signals", () => {
    const s = toSignals({
      pr: listed as any,
      files: [{ filename: "auth/keys.ts", additions: 10, deletions: 2 }],
      reviews: [{ user: { login: "sam" }, state: "APPROVED", submitted_at: "2026-11-25T10:00:00Z" }],
      ciStatus: "failure",
      repo: "acme/platform",
    });
    expect(s.number).toBe(7);
    expect(s.author).toBe("sentinel-agent[bot]");
    expect(s.authorIsBot).toBe(true);
    expect(s.labels).toEqual(["security"]);
    expect(s.requestedReviewers).toEqual(["sam", "@sec"]);
    expect(s.files).toEqual(["auth/keys.ts"]);
    expect(s.additions).toBe(10);
    expect(s.reviews[0]).toEqual({ author: "sam", state: "APPROVED", submittedAt: new Date("2026-11-25T10:00:00Z") });
    expect(s.ciStatus).toBe("failure");
    expect(s.url).toBe("https://github.com/acme/platform/pull/7");
  });
});

describe("collectPullRequests", () => {
  test("lists open PRs, enriches each, derives CI status from checks and statuses, and routes via CODEOWNERS", async () => {
    const calls: Record<string, any[]> = {};
    const items = await collectPullRequests(stub(calls), { owner: "acme", repo: "platform" }, { now: new Date("2026-11-27T12:00:00Z") });
    expect(calls["pulls.list"]![0]).toMatchObject({ state: "open", per_page: 100 });
    expect(items).toHaveLength(1);
    const [item] = items;
    expect(item!.signals.ciStatus).toBe("failure");
    expect(item!.signals.linkedIssueSeverity).toBe("High");
    expect(item!.assessment.priority).toBe("P1"); // failing CI: the author owns the next step, so never urgent
    expect(item!.assessment.suggestedReviewers).toEqual(["security-lead"]);
    expect(calls["issues.get"]![0]).toMatchObject({ issue_number: 12 });
  });

  test("tolerates a missing CODEOWNERS file and missing check permissions", async () => {
    const s = stub();
    s.repos.getContent = async () => { const e: any = new Error("nf"); e.status = 404; throw e; };
    s.checks.listForRef = async () => { const e: any = new Error("forbidden"); e.status = 403; throw e; };
    const items = await collectPullRequests(s, { owner: "acme", repo: "platform" });
    expect(items[0]!.assessment.suggestedReviewers).toEqual([]);
    expect(items[0]!.signals.ciStatus).toBe("success");
  });
});
