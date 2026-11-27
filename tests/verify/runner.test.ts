import { existsSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createDemoShop } from "../../src/verify/demo-app.js";
import { DEMO_JOURNEYS } from "../../src/verify/demo.js";
import { findChrome, runJourneys } from "../../src/verify/runner.js";

const chrome = findChrome();
const d = chrome ? describe : describe.skip;

d("runJourneys against the demo shop (real Chrome)", () => {
  let server: ReturnType<typeof serve>;
  let baseUrl = "";
  const outDir = mkdtempSync(join(tmpdir(), "carrot-verify-"));

  beforeAll(async () => {
    const app = createDemoShop({ couponTtlMs: 300 });
    await new Promise<void>((resolve) => { server = serve({ fetch: app.fetch, port: 0 }, (info) => { baseUrl = `http://127.0.0.1:${info.port}`; resolve(); }); });
  });
  afterAll(() => { server?.close(); });

  test("finds both planted bugs, passes the negative case, and keeps evidence", async () => {
    const run = await runJourneys(DEMO_JOURNEYS, { baseUrl, outDir, executablePath: chrome!, headless: true, revision: "9f2c4a1", stepTimeoutMs: 5000 });
    expect(run.summary).toEqual({ passed: 1, failed: 2, blocked: 0 });
    const byId = Object.fromEntries(run.runs.map((r) => [r.journey.id, r]));

    const discount = byId["apply-discount-at-checkout"]!;
    expect(discount.status).toBe("failed");
    const failed = discount.steps.find((s) => s.status === "failed")!;
    expect(failed.step).toEqual({ action: "expect_text", value: "Charged $80.00" });
    expect(failed.error).toMatch(/Charged \$80\.00/);
    expect(discount.steps.filter((s) => s.status === "skipped")).toHaveLength(0);
    expect(discount.finding).toBeDefined();
    expect(discount.finding!.observed).toContain("Charged $100.00");
    expect(discount.finding!.expected).toContain("$80");
    expect(discount.finding!.stepIndex).toBe(failed.index);

    const refresh = byId["keep-discount-after-refresh"]!;
    expect(refresh.status).toBe("failed");
    expect(refresh.steps.find((s) => s.status === "failed")!.step.action).toBe("expect_text");

    const invalid = byId["reject-invalid-coupon"]!;
    expect(invalid.status).toBe("passed");
    expect(invalid.steps.every((s) => s.status === "passed")).toBe(true);

    // Evidence: a screenshot per step, a recording per journey, console and network logs.
    expect(discount.evidence.screenshots.length).toBe(discount.steps.length);
    for (const shot of discount.evidence.screenshots) expect(existsSync(join(run.dir!, shot))).toBe(true);
    expect(discount.evidence.recording).toMatch(/\.webm$/);
    expect(statSync(join(run.dir!, discount.evidence.recording!)).size).toBeGreaterThan(0);
    expect(discount.evidence.network.some((n) => n.url.endsWith("/coupon") && n.method === "POST")).toBe(true);
    expect(run.environment.browser).toMatch(/Chrom/);
    expect(run.revision).toBe("9f2c4a1");
    expect(readdirSync(run.dir!)).toContain("run.json");
  }, 90_000);

  test("a journey that leaves the application's origin fails on that step", async () => {
    const run = await runJourneys([{ id: "away", title: "Away", goal: "g", steps: [{ action: "goto", url: "/" }, { action: "goto", url: "http://169.254.169.254/latest/meta-data" }], source: "generated" }], { baseUrl, outDir, executablePath: chrome!, headless: true, stepTimeoutMs: 3000 });
    expect(run.runs[0]!.status).toBe("failed");
    expect(run.runs[0]!.steps[1]!.error).toMatch(/origin/);
  }, 30_000);

  test("a journey whose first step cannot run is blocked, not failed", async () => {
    const run = await runJourneys([{ id: "nowhere", title: "Nowhere", goal: "g", steps: [{ action: "goto", url: "/" }, { action: "expect_text", value: "x" }], source: "saved" }], { baseUrl: "http://127.0.0.1:1", outDir, executablePath: chrome!, headless: true, stepTimeoutMs: 3000 });
    expect(run.runs[0]!.status).toBe("blocked");
    expect(run.runs[0]!.steps[1]!.status).toBe("skipped");
  }, 30_000);
});

describe("findChrome", () => {
  test("returns a path or undefined without throwing", () => {
    expect(chrome === undefined || typeof chrome === "string").toBe(true);
  });
});
