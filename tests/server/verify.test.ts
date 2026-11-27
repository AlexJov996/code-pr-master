import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { createApp } from "../../src/server/app.js";
import type { VerifyRun } from "../../src/verify/schema.js";

const base = { webhookSecret: "s", onPullRequest: async () => {}, onIssueComment: async () => {} };
const root = mkdtempSync(join(tmpdir(), "carrot-verify-srv-"));
const runDir = join(root, "run-1");
mkdirSync(join(runDir, "j1"), { recursive: true });
writeFileSync(join(runDir, "j1", "step-01.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
const run: VerifyRun = {
  id: "run-1", baseUrl: "http://localhost:4000", environment: { browser: "Chromium 158", viewport: "1280x720", headless: true },
  startedAt: "2026-11-27T12:00:00.000Z", finishedAt: "2026-11-27T12:00:01.000Z", dir: runDir, summary: { passed: 0, failed: 1, blocked: 0 },
  runs: [{ journey: { id: "j1", title: "J1", goal: "g", source: "saved", steps: [{ action: "goto", url: "/" }] }, status: "failed", startedAt: "2026-11-27T12:00:00.000Z", durationMs: 10, steps: [{ index: 0, step: { action: "goto", url: "/" }, status: "failed", durationMs: 10, error: "boom", screenshot: "j1/step-01.png" }], evidence: { screenshots: ["j1/step-01.png"], logs: [], network: [] }, finding: { title: "T", expected: "e", observed: "o", guidance: "g", stepIndex: 0 } }],
};
writeFileSync(join(runDir, "run.json"), JSON.stringify(run));

describe("verify routes", () => {
  const app = createApp({ ...base, verify: { runsDir: root } });

  test("lists runs and renders one", async () => {
    const list = await (await app.request("/verify")).text();
    expect(list).toContain("run-1");
    expect(list).toContain("1 bug");
    const page = await (await app.request("/verify?run=run-1")).text();
    expect(page).toContain("Verify · run-1");
    expect(page).toContain('src="/verify/artifacts/run-1/j1/step-01.png"');
  });

  test("serves artifacts from the run directory only", async () => {
    const ok = await app.request("/verify/artifacts/run-1/j1/step-01.png");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("image/png");
    expect([400, 404]).toContain((await app.request("/verify/artifacts/run-1/../../etc/passwd")).status);
    expect([400, 404]).toContain((await app.request("/verify/artifacts/run-1/%2e%2e/%2e%2e/etc/passwd")).status);
    expect((await app.request("/verify/artifacts/run-1/j1/nope.png")).status).toBe(404);
  });

  test("serves json and markdown and 404s unknown runs", async () => {
    const json = (await (await app.request("/api/verify.json?run=run-1")).json()) as any;
    expect(json.summary.failed).toBe(1);
    expect((await (await app.request("/api/verify.md?run=run-1")).text())).toContain("Verify · 1 bug");
    expect((await app.request("/verify?run=nope")).status).toBe(404);
    expect((await createApp(base).request("/verify")).status).toBe(404);
  });
});
