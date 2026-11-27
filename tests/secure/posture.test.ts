import { describe, expect, test } from "vitest";
import { buildPosture, renderPosturePage, renderScanMarkdown, SECURITY_MARKER } from "../../src/secure/posture.js";
import type { ScanResult, SecurityFinding } from "../../src/secure/schema.js";

const f = (over: Partial<SecurityFinding>): SecurityFinding => ({
  id: "x", category: "Server side", title: "T.", path: "api/a.ts", line: 1, severity: "High", description: "D", attackPath: ["req.body.url", "fetch(url)"], source: "pattern",
  verification: { reachability: "Reachable", exploitability: "Easy", blastRadius: "Medium", verdict: "Confirmed", reasoning: "R" }, ...over,
});

const result: ScanResult = {
  mode: "files",
  scannedAt: "2026-11-27T12:00:00.000Z",
  walked: ["core/a.ts", "core/b.ts", "api/a.ts", "api/b.ts", "auth/login.ts", "workers/w.ts"],
  skipped: ["README.md"],
  findings: [
    f({ id: "1", path: "auth/login.ts", severity: "Critical", category: "Access control", title: "JWT accepts none.", verification: { reachability: "Reachable", exploitability: "Easy", blastRadius: "High", verdict: "Confirmed", reasoning: "R" } }),
    f({ id: "2", path: "api/a.ts", severity: "High" }),
    f({ id: "3", path: "api/b.ts", severity: "Medium", verification: { reachability: "Unknown", exploitability: "Unknown", blastRadius: "Unknown", verdict: "Needs review", reasoning: "" } }),
    f({ id: "4", path: "core/a.ts", severity: "Low", verification: { reachability: "Unknown", exploitability: "Unknown", blastRadius: "Unknown", verdict: "Needs review", reasoning: "" }, fix: { description: "Use allowlist.", diff: "-a\n+b", pullRequestUrl: "https://github.com/acme/x/pull/9" } }),
  ],
  rejected: [f({ id: "5", path: "core/b.ts", verification: { reachability: "Reachable", exploitability: "Not exploitable", blastRadius: "Low", verdict: "Rejected", reasoning: "Allowlisted." } })],
};

describe("buildPosture", () => {
  const p = buildPosture(result, { totalFiles: { core: 2, api: 2, auth: 3, workers: 1 } });

  test("groups by top-level area with walked counts and severity buckets", () => {
    expect(p.areas.map((a) => [a.name, a.walked, a.total, a.highOrCritical, a.medium, a.verified])).toEqual([
      ["auth", 1, 3, 1, 0, 1],
      ["api", 2, 2, 1, 1, 1],
      ["core", 2, 2, 0, 0, 0],
      ["workers", 1, 1, 0, 0, 0],
    ]);
  });

  test("summarizes totals including rejected and fixed counts", () => {
    expect(p.totals).toEqual({ findings: 4, critical: 1, high: 1, medium: 1, low: 1, verified: 2, needsReview: 2, rejected: 1, fixed: 1, walked: 6, total: 8 });
  });

  test("orders areas worst first", () => {
    expect(p.areas[0]!.name).toBe("auth");
  });
});

describe("renderScanMarkdown", () => {
  const md = renderScanMarkdown(result, { repo: "acme/x" });

  test("starts with the marker and summarizes severities", () => {
    expect(md.startsWith(SECURITY_MARKER)).toBe(true);
    expect(md).toContain("🔴 1 Critical");
    expect(md).toContain("🟠 1 High");
  });

  test("lists each finding with verification, attack path and fix link", () => {
    expect(md).toContain("JWT accepts none.");
    expect(md).toContain("`auth/login.ts:1`");
    expect(md).toContain("Reachable · Easy to exploit · High blast radius");
    expect(md).toContain("req.body.url → fetch(url)");
    expect(md).toContain("https://github.com/acme/x/pull/9");
  });

  test("shows rejected findings in a collapsed section", () => {
    expect(md).toContain("Rejected by verification (1)");
    expect(md).toContain("Allowlisted.");
  });
});

describe("renderPosturePage", () => {
  const html = renderPosturePage(result, { repo: "acme/x", totalFiles: { core: 2, api: 2, auth: 3, workers: 1 } });

  test("renders the posture map and the findings list", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>Security · acme/x</title>");
    expect(html).toContain('class="area"');
    expect(html).toContain("auth");
    expect(html).toContain("1/3");
    expect(html).toContain("JWT accepts none.");
    expect(html).toContain("Not yet walked");
  });

  test("escapes untrusted text", () => {
    const evil = { ...result, findings: [f({ title: "<script>x</script>" })] };
    expect(renderPosturePage(evil, { repo: "a/b" })).toContain("&lt;script&gt;x&lt;/script&gt;");
  });
});
