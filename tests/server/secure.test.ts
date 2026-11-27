import { describe, expect, test } from "vitest";
import { createApp } from "../../src/server/app.js";
import type { ScanResult } from "../../src/secure/schema.js";

const base = { webhookSecret: "s", onPullRequest: async () => {}, onIssueComment: async () => {} };
const result: ScanResult = {
  mode: "files", scannedAt: "2026-11-27T12:00:00.000Z", walked: ["api/a.ts"], skipped: [],
  findings: [{ id: "1", category: "Server side", title: "SSRF.", path: "api/a.ts", line: 2, severity: "High", description: "d", attackPath: [], source: "pattern", verification: { reachability: "Reachable", exploitability: "Easy", blastRadius: "High", verdict: "Confirmed", reasoning: "r" } }],
  rejected: [],
};

describe("secure routes", () => {
  const app = createApp({ ...base, secure: { load: async (repo) => (repo === "acme/x" ? { result, totalFiles: { api: 3 } } : undefined) } });

  test("renders the posture page for a repository with a stored scan", async () => {
    const res = await app.request("/secure?repo=acme/x");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Security · acme/x");
    expect(html).toContain("1/3");
    expect(html).toContain("SSRF.");
  });

  test("serves the scan as json and markdown", async () => {
    const json = (await (await app.request("/api/secure.json?repo=acme/x")).json()) as any;
    expect(json.posture.totals.high).toBe(1);
    expect(json.result.findings[0].title).toBe("SSRF.");
    const md = await (await app.request("/api/secure.md?repo=acme/x")).text();
    expect(md).toContain("Security scan");
  });

  test("404s for a repository without a scan and 400s on a bad repo", async () => {
    expect((await app.request("/secure?repo=acme/none")).status).toBe(404);
    expect((await app.request("/secure?repo=bad")).status).toBe(400);
    expect((await createApp(base).request("/secure?repo=a/b")).status).toBe(404);
  });
});
