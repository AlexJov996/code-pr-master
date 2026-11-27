import { describe, expect, test } from "vitest";
import { SUMMARY_MARKER } from "../../src/core/format.js";
import type { ReviewResult } from "../../src/core/schema.js";
import { fetchPullRequest, loadRepoConfig, publishReview, type OctokitLike } from "../../src/github/pr.js";

const ref = { owner: "acme", repo: "platform", number: 482 };

function stub(calls: Record<string, any[]>, overrides: Partial<Record<string, (...a: any[]) => any>> = {}): OctokitLike {
  const rec = (name: string, impl: (...a: any[]) => any) => async (...a: any[]) => { (calls[name] ??= []).push(a[0]); return impl(...a); };
  return {
    pulls: {
      get: rec("pulls.get", overrides["pulls.get"] ?? ((p: any) => p.mediaType?.format === "diff"
        ? { data: "diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1,1 +1,1 @@\n-a\n+b\n" }
        : { data: { title: "T", body: "D", draft: false, head: { sha: "abc" }, base: { ref: "main" }, user: { login: "casey" }, state: "open" } })),
      createReview: rec("pulls.createReview", overrides["pulls.createReview"] ?? (() => ({ data: { id: 9 } }))),
    },
    issues: {
      listComments: rec("issues.listComments", overrides["issues.listComments"] ?? (() => ({ data: [] }))),
      createComment: rec("issues.createComment", overrides["issues.createComment"] ?? (() => ({ data: { id: 1 } }))),
      updateComment: rec("issues.updateComment", overrides["issues.updateComment"] ?? (() => ({ data: { id: 1 } }))),
    },
    repos: {
      getContent: rec("repos.getContent", overrides["repos.getContent"] ?? (() => { const e: any = new Error("Not Found"); e.status = 404; throw e; })),
    },
  } as unknown as OctokitLike;
}

const result: ReviewResult = {
  walkthrough: "w", changes: [], effort: 1, checks: [], generalComments: [], model: "m", profile: "chill",
  findings: [{ path: "x.ts", line: 1, category: "Security", severity: "Major", effort: "Quick win", title: "T.", body: "B", agent_prompt: "P" }],
};

describe("fetchPullRequest", () => {
  test("returns metadata and the raw diff", async () => {
    const calls: Record<string, any[]> = {};
    const pr = await fetchPullRequest(stub(calls), ref);
    expect(pr.title).toBe("T");
    expect(pr.description).toBe("D");
    expect(pr.headSha).toBe("abc");
    expect(pr.diff).toContain("diff --git a/x.ts");
    expect(calls["pulls.get"]).toHaveLength(2);
  });
});

describe("loadRepoConfig", () => {
  test("falls back to defaults when the file is missing", async () => {
    const cfg = await loadRepoConfig(stub({}), { ...ref, ref: "abc" });
    expect(cfg.reviews.profile).toBe("chill");
  });

  test("parses the base64 file content when present", async () => {
    const content = Buffer.from("reviews:\n  profile: quiet\n").toString("base64");
    const cfg = await loadRepoConfig(stub({}, { "repos.getContent": () => ({ data: { type: "file", content, encoding: "base64" } }) }), { ...ref, ref: "abc" });
    expect(cfg.reviews.profile).toBe("quiet");
  });

  test("tries the .yml name when .yaml is missing", async () => {
    const calls: Record<string, any[]> = {};
    await loadRepoConfig(stub(calls), { ...ref, ref: "abc" });
    expect(calls["repos.getContent"]!.map((c) => c.path)).toEqual([".carrot-review.yaml", ".carrot-review.yml"]);
  });
});

describe("publishReview", () => {
  test("creates the summary comment when none exists and posts inline comments as one review", async () => {
    const calls: Record<string, any[]> = {};
    await publishReview(stub(calls), { ...ref, headSha: "abc" }, result);
    expect(calls["issues.createComment"]![0].body.startsWith(SUMMARY_MARKER)).toBe(true);
    expect(calls["issues.updateComment"]).toBeUndefined();
    const review = calls["pulls.createReview"]![0];
    expect(review.commit_id).toBe("abc");
    expect(review.event).toBe("COMMENT");
    expect(review.comments).toEqual([{ path: "x.ts", line: 1, side: "RIGHT", body: expect.stringContaining("**T.**") }]);
  });

  test("updates the existing summary comment instead of creating a second one", async () => {
    const calls: Record<string, any[]> = {};
    const existing = { id: 77, body: `${SUMMARY_MARKER}\nold`, user: { type: "Bot", login: "carrot-review[bot]" } };
    await publishReview(stub(calls, { "issues.listComments": () => ({ data: [{ id: 1, body: "hi", user: { type: "User" } }, existing] }) }), { ...ref, headSha: "abc" }, result);
    expect(calls["issues.updateComment"]![0].comment_id).toBe(77);
    expect(calls["issues.createComment"]).toBeUndefined();
  });

  test("skips the review call when there are no inline findings", async () => {
    const calls: Record<string, any[]> = {};
    await publishReview(stub(calls), { ...ref, headSha: "abc" }, { ...result, findings: [] });
    expect(calls["pulls.createReview"]).toBeUndefined();
  });

  test("uses start_line for multi-line findings", async () => {
    const calls: Record<string, any[]> = {};
    const multi = { ...result, findings: [{ ...result.findings[0]!, line: 1, end_line: 1 }, { ...result.findings[0]!, line: 3, end_line: 5, title: "Range." }] };
    await publishReview(stub(calls), { ...ref, headSha: "abc" }, multi);
    const comments = calls["pulls.createReview"]![0].comments;
    expect(comments[0]).not.toHaveProperty("start_line");
    expect(comments[1]).toMatchObject({ start_line: 3, start_side: "RIGHT", line: 5, side: "RIGHT" });
  });

  test("falls back to the summary when GitHub rejects the inline comments", async () => {
    const calls: Record<string, any[]> = {};
    const octokit = stub(calls, { "pulls.createReview": () => { const e: any = new Error("Unprocessable"); e.status = 422; throw e; } });
    await publishReview(octokit, { ...ref, headSha: "abc" }, result);
    expect(calls["issues.createComment"]).toHaveLength(1);
    expect(calls["issues.updateComment"]![0].body).toContain("Additional comments (1)");
  });
});
