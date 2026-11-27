import { describe, expect, test } from "vitest";
import { parseConfig } from "../../src/core/config.js";
import { SECURITY_MARKER } from "../../src/secure/posture.js";
import { runPullRequestScan } from "../../src/secure/pipeline.js";

const diff = "diff --git a/src/api/preview.ts b/src/api/preview.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/api/preview.ts\n@@ -0,0 +1,3 @@\n+const { url } = req.body;\n+const img = await fetch(url);\n+res.send(img);\n";

function stub(calls: Record<string, any[]>) {
  const rec = (n: string, impl: (p: any) => any) => async (p: any) => { (calls[n] ??= []).push(p); return impl(p); };
  return {
    pulls: {
      get: rec("pulls.get", (p: any) => p.mediaType?.format === "diff" ? { data: diff } : { data: { title: "t", body: "", draft: false, head: { sha: "abc", ref: "feat" }, base: { ref: "main" }, user: { login: "casey" }, state: "open" } }),
      createReview: rec("pulls.createReview", () => ({ data: { id: 1 } })),
      create: rec("pulls.create", () => ({ data: { html_url: "https://github.com/acme/x/pull/77", number: 77 } })),
    },
    issues: { listComments: rec("issues.listComments", () => ({ data: [] })), createComment: rec("issues.createComment", () => ({ data: { id: 5 } })), updateComment: rec("issues.updateComment", () => ({ data: { id: 5 } })) },
    repos: { getContent: rec("repos.getContent", () => ({ data: { type: "file", sha: "fs", content: Buffer.from("const { url } = req.body;\nconst img = await fetch(url);\nres.send(img);\n").toString("base64"), encoding: "base64" } })), createOrUpdateFileContents: rec("repos.createOrUpdateFileContents", () => ({ data: {} })) },
    git: { getRef: rec("git.getRef", () => ({ data: { object: { sha: "base" } } })), createRef: rec("git.createRef", () => ({ data: {} })) },
  } as any;
}

describe("runPullRequestScan", () => {
  test("scans the diff, posts a sticky security comment and inline comments on the added lines", async () => {
    const calls: Record<string, any[]> = {};
    const out = await runPullRequestScan(stub(calls), { owner: "acme", repo: "x", number: 1 }, parseConfig("security:\n  min_severity: Low\n"), {});
    expect(out.result.findings.map((f) => f.ruleId)).toEqual(["ssrf-user-url"]);
    expect(calls["issues.createComment"]![0].body.startsWith(SECURITY_MARKER)).toBe(true);
    expect(calls["pulls.createReview"]![0].comments[0]).toMatchObject({ path: "src/api/preview.ts", line: 2, side: "RIGHT" });
    expect(calls["pulls.createReview"]![0].comments[0].body).toContain("🔒");
    expect(calls["pulls.create"]).toBeUndefined();
  });

  test("with auto-fix on and a fix generator, drafts a fix and opens a pull request for confirmed high findings", async () => {
    const calls: Record<string, any[]> = {};
    const config = parseConfig("security:\n  auto_fix: true\n  min_severity: Low\n");
    const out = await runPullRequestScan(stub(calls), { owner: "acme", repo: "x", number: 1 }, config, {
      verify: async () => ({ reachability: "Reachable", exploitability: "Easy", blastRadius: "High", verdict: "Confirmed", reasoning: "r" }),
      fix: async () => ({ description: "Allowlist hosts.", patched_content: "const { url } = req.body;\nif (!allowed(url)) throw new Error('no');\nconst img = await fetch(url);\nres.send(img);\n" }),
    });
    expect(out.result.findings[0]!.fix?.pullRequestUrl).toBe("https://github.com/acme/x/pull/77");
    expect(calls["pulls.create"]![0]).toMatchObject({ base: "feat" });
    expect(calls["issues.createComment"]![0].body).toContain("https://github.com/acme/x/pull/77");
  });

  test("posts a clean summary and no review when nothing is found", async () => {
    const calls: Record<string, any[]> = {};
    const clean = stub(calls);
    clean.pulls.get = async (p: any) => p.mediaType?.format === "diff" ? { data: "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,1 +1,1 @@\n-a\n+b\n" } : { data: { title: "t", body: "", head: { sha: "abc", ref: "feat" }, base: { ref: "main" }, user: { login: "c" }, state: "open" } };
    const out = await runPullRequestScan(clean, { owner: "acme", repo: "x", number: 1 }, parseConfig(""), {});
    expect(out.result.findings).toEqual([]);
    expect(calls["pulls.createReview"]).toBeUndefined();
    expect(calls["issues.createComment"]![0].body).toContain("No verified or pending security findings");
  });
});
