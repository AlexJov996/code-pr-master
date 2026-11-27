import { describe, expect, test } from "vitest";
import { renderRepairHandoff, renderVerifyMarkdown, renderVerifyPage, VERIFY_MARKER } from "../../src/verify/report.js";
import type { VerifyRun } from "../../src/verify/schema.js";

const run: VerifyRun = {
  id: "run-1", baseUrl: "http://localhost:4000", revision: "9f2c4a1", environment: { browser: "Chromium 158", viewport: "1280x720", headless: true },
  startedAt: "2026-11-27T12:00:00.000Z", finishedAt: "2026-11-27T12:00:24.000Z", dir: "/tmp/run-1",
  summary: { passed: 1, failed: 1, blocked: 0 },
  runs: [
    {
      journey: { id: "apply-discount-at-checkout", title: "Apply the discount at checkout", goal: "Complete an order with a valid discount.", expected: "The order total and the recorded charge both equal $80.", source: "generated", steps: [{ action: "goto", url: "/" }, { action: "click", target: { role: "button", name: "Place order" } }, { action: "expect_text", value: "Charged $80.00" }] },
      status: "failed", startedAt: "2026-11-27T12:00:00.000Z", durationMs: 2400,
      steps: [
        { index: 0, step: { action: "goto", url: "/" }, status: "passed", durationMs: 300, url: "http://localhost:4000/", screenshot: "apply-discount-at-checkout/step-01.png" },
        { index: 1, step: { action: "click", target: { role: "button", name: "Place order" } }, status: "passed", durationMs: 200, url: "http://localhost:4000/checkout/confirmation?order=o2", screenshot: "apply-discount-at-checkout/step-02.png" },
        { index: 2, step: { action: "expect_text", value: "Charged $80.00" }, status: "failed", durationMs: 1900, url: "http://localhost:4000/checkout/confirmation?order=o2", error: 'Expected text "Charged $80.00" to be visible.', screenshot: "apply-discount-at-checkout/step-03.png" },
      ],
      evidence: { screenshots: ["apply-discount-at-checkout/step-01.png", "apply-discount-at-checkout/step-02.png", "apply-discount-at-checkout/step-03.png"], recording: "apply-discount-at-checkout/recording.webm", logs: [{ ts: 1, level: "error", text: "Uncaught TypeError: x" }], network: [{ ts: 1, method: "POST", url: "http://localhost:4000/checkout", status: 302 }] },
      finding: { title: "Discount is missing from the recorded charge", expected: "The order total and the recorded charge both equal $80.", observed: "The confirmation shows Order total $80.00 but Charged $100.00.", guidance: "Keep the displayed total and the recorded charge consistent.", stepIndex: 2 },
    },
    {
      journey: { id: "reject-invalid-coupon", title: "Reject an invalid coupon", goal: "g", source: "generated", steps: [{ action: "goto", url: "/" }] },
      status: "passed", startedAt: "2026-11-27T12:00:03.000Z", durationMs: 500,
      steps: [{ index: 0, step: { action: "goto", url: "/" }, status: "passed", durationMs: 500, url: "http://localhost:4000/" }],
      evidence: { screenshots: [], logs: [], network: [] },
    },
  ],
};

describe("renderVerifyMarkdown", () => {
  const md = renderVerifyMarkdown(run);
  test("starts with the marker and summarizes bugs and passes", () => {
    expect(md.startsWith(VERIFY_MARKER)).toBe(true);
    expect(md).toContain("1 bug · 1 passed");
    expect(md).toContain("9f2c4a1");
  });
  test("lists each scenario with status and the finding's expected, observed and guidance", () => {
    expect(md).toContain("❌ Apply the discount at checkout");
    expect(md).toContain("✅ Reject an invalid coupon");
    expect(md).toContain("**Expected:** The order total and the recorded charge both equal $80.");
    expect(md).toContain("**Observed:** The confirmation shows Order total $80.00 but Charged $100.00.");
    expect(md).toContain("**Developer guidance:** Keep the displayed total");
    expect(md).toContain("apply-discount-at-checkout/step-03.png");
  });
});

describe("renderRepairHandoff", () => {
  const h = renderRepairHandoff(run, run.runs[0]!);
  test("packages finding, revision, environment, steps to reproduce and evidence for a coding agent", () => {
    expect(h).toContain("# Repair handoff");
    expect(h).toContain("Discount is missing from the recorded charge");
    expect(h).toContain("Tested revision: 9f2c4a1");
    expect(h).toContain("Chromium 158");
    expect(h).toMatch(/1\. goto \//);
    expect(h).toMatch(/3\. expect_text "Charged \$80\.00" ← failed/);
    expect(h).toContain("recording.webm");
    expect(h).toContain("Uncaught TypeError: x");
    expect(h).toContain("Verify the finding against the current code");
  });
});

describe("renderVerifyPage", () => {
  const html = renderVerifyPage(run, { artifactBase: "/verify/artifacts/run-1" });
  test("renders scenario list, evidence tabs with video, screenshots and logs, and the handoff", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>Verify · run-1</title>");
    expect(html).toMatch(/class="scenario failed( active)?"/);
    expect(html).toContain('<video controls src="/verify/artifacts/run-1/apply-discount-at-checkout/recording.webm"');
    expect(html).toContain('src="/verify/artifacts/run-1/apply-discount-at-checkout/step-03.png"');
    expect(html).toContain("Uncaught TypeError: x");
    expect(html).toContain("Repair handoff");
    expect(html).toContain("Bug found");
  });
  test("escapes untrusted text", () => {
    const evil = { ...run, runs: [{ ...run.runs[1]!, journey: { ...run.runs[1]!.journey, title: "<b>x</b>" } }] };
    expect(renderVerifyPage(evil, { artifactBase: "/a" })).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});
