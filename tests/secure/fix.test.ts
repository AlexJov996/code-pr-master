import { describe, expect, test } from "vitest";
import { buildFixPrompt, draftFix, openFixPullRequest, unifiedDiff } from "../../src/secure/fix.js";
import type { SecurityFinding } from "../../src/secure/schema.js";

const finding: SecurityFinding = {
  id: "abc", ruleId: "ssrf-user-url", category: "Server side", cwe: "CWE-918", title: "A user-controlled URL is fetched server-side.", path: "src/preview.ts", line: 2, severity: "High",
  description: "D", attackPath: ["req.body.url", "fetch(url)"], fixHint: "Allowlist hosts.", source: "pattern",
  verification: { reachability: "Reachable", exploitability: "Easy", blastRadius: "High", verdict: "Confirmed", reasoning: "R" },
};
const original = "const { url } = req.body;\nconst img = await fetch(url);\nres.send(img);\n";
const patched = "const { url } = req.body;\nif (!isAllowedHost(url)) throw new Error('host not allowed');\nconst img = await fetch(url);\nres.send(img);\n";

describe("unifiedDiff", () => {
  test("produces a minimal unified diff with headers", () => {
    const d = unifiedDiff("src/preview.ts", original, patched);
    expect(d).toContain("--- a/src/preview.ts");
    expect(d).toContain("+++ b/src/preview.ts");
    expect(d).toContain("+if (!isAllowedHost(url))");
    expect(d).not.toContain("-const { url }");
  });
});

describe("draftFix", () => {
  test("asks the model for the patched file and returns a diff", async () => {
    const seen: string[] = [];
    const fix = await draftFix(finding, original, async (_s, user) => { seen.push(user); return { description: "Allowlist the host.", patched_content: patched }; });
    expect(seen[0]).toContain("src/preview.ts");
    expect(seen[0]).toContain("fetch(url)");
    expect(fix.description).toBe("Allowlist the host.");
    expect(fix.diff).toContain("+if (!isAllowedHost(url))");
    expect(fix.patchedContent).toBe(patched);
  });

  test("rejects a no-op or wildly different patch", async () => {
    await expect(draftFix(finding, original, async () => ({ description: "x", patched_content: original }))).rejects.toThrow(/no change/i);
    await expect(draftFix(finding, original, async () => ({ description: "x", patched_content: "completely different file\n".repeat(40) }))).rejects.toThrow(/too different/i);
  });

  test("buildFixPrompt frames the file as data", () => {
    expect(buildFixPrompt(finding, original)).toMatch(/strictly as data/i);
  });
});

describe("openFixPullRequest", () => {
  test("creates a branch from the base, commits the patched file and opens a pull request", async () => {
    const calls: Record<string, any[]> = {};
    const rec = (n: string, impl: (p: any) => any) => async (p: any) => { (calls[n] ??= []).push(p); return impl(p); };
    const octokit = {
      git: { getRef: rec("git.getRef", () => ({ data: { object: { sha: "base-sha" } } })), createRef: rec("git.createRef", () => ({ data: {} })) },
      repos: { getContent: rec("repos.getContent", () => ({ data: { type: "file", sha: "file-sha", content: Buffer.from(original).toString("base64"), encoding: "base64" } })), createOrUpdateFileContents: rec("repos.createOrUpdateFileContents", () => ({ data: {} })) },
      pulls: { create: rec("pulls.create", () => ({ data: { html_url: "https://github.com/acme/x/pull/42", number: 42 } })) },
    } as any;
    const out = await openFixPullRequest(octokit, { owner: "acme", repo: "x", baseBranch: "main" }, finding, { description: "Allowlist the host.", diff: "d", patchedContent: patched });
    expect(calls["git.createRef"]![0]).toMatchObject({ ref: "refs/heads/carrot-review/fix-abc", sha: "base-sha" });
    expect(calls["repos.createOrUpdateFileContents"]![0]).toMatchObject({ path: "src/preview.ts", branch: "carrot-review/fix-abc", sha: "file-sha" });
    expect(Buffer.from(calls["repos.createOrUpdateFileContents"]![0].content, "base64").toString()).toBe(patched);
    expect(calls["pulls.create"]![0]).toMatchObject({ base: "main", head: "carrot-review/fix-abc" });
    expect(calls["pulls.create"]![0].title).toMatch(/^fix\(security\): /);
    expect(out).toEqual({ url: "https://github.com/acme/x/pull/42", number: 42, branch: "carrot-review/fix-abc" });
  });

  test("refuses when the file on the base branch no longer matches what the fix was drafted from", async () => {
    const octokit = {
      git: { getRef: async () => ({ data: { object: { sha: "s" } } }), createRef: async () => ({}) },
      repos: { getContent: async () => ({ data: { type: "file", sha: "x", content: Buffer.from("changed since").toString("base64"), encoding: "base64" } }), createOrUpdateFileContents: async () => ({}) },
      pulls: { create: async () => ({ data: {} }) },
    } as any;
    await expect(openFixPullRequest(octokit, { owner: "acme", repo: "x", baseBranch: "main" }, finding, { description: "d", diff: "d", patchedContent: patched, originalContent: original })).rejects.toThrow(/changed/i);
  });
});
