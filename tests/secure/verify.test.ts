import { describe, expect, test } from "vitest";
import type { SecurityFinding } from "../../src/secure/schema.js";
import { applyVerification, excerpt, heuristicReachability, verifyFindings } from "../../src/secure/verify.js";

const base: SecurityFinding = {
  id: "f1", ruleId: "ssrf-user-url", category: "Server side", title: "User-supplied URL is fetched server-side.",
  path: "src/api/preview.ts", line: 2, severity: "High", description: "d", attackPath: ["req.body.url", "fetch(url)"], source: "pattern",
  verification: { reachability: "Unknown", exploitability: "Unknown", blastRadius: "Unknown", verdict: "Needs review", reasoning: "" },
};

describe("heuristicReachability", () => {
  test("tests, fixtures, docs and examples are unreachable; handlers and routes are reachable", () => {
    expect(heuristicReachability("tests/api/preview.test.ts")).toBe("Unreachable");
    expect(heuristicReachability("docs/example.md")).toBe("Unreachable");
    expect(heuristicReachability("examples/demo.ts")).toBe("Unreachable");
    expect(heuristicReachability("src/api/preview.ts")).toBe("Reachable");
    expect(heuristicReachability("src/routes/invoices.ts")).toBe("Reachable");
    expect(heuristicReachability("src/lib/util.ts")).toBe("Unknown");
  });

  test("example, sample and template files are unreachable placeholders", () => {
    expect(heuristicReachability(".env.example")).toBe("Unreachable");
    expect(heuristicReachability("config/settings.sample.yaml")).toBe("Unreachable");
    expect(heuristicReachability("deploy/values.template.yml")).toBe("Unreachable");
    expect(heuristicReachability(".env")).not.toBe("Unreachable");
  });
});

describe("applyVerification", () => {
  test("caps unreachable findings at Low and marks them confirmed-but-capped", () => {
    const out = applyVerification(base, { reachability: "Unreachable", exploitability: "Easy", blastRadius: "High", verdict: "Confirmed", reasoning: "Only in tests." });
    expect(out.severity).toBe("Low");
    expect(out.verification.verdict).toBe("Confirmed");
  });

  test("rejects findings the verifier calls not exploitable", () => {
    const out = applyVerification(base, { reachability: "Reachable", exploitability: "Not exploitable", blastRadius: "Low", verdict: "Rejected", reasoning: "Allowlisted hosts." });
    expect(out.verification.verdict).toBe("Rejected");
  });

  test("downgrades hard-to-exploit findings one level and upgrades high blast radius one level", () => {
    expect(applyVerification(base, { reachability: "Reachable", exploitability: "Hard", blastRadius: "Low", verdict: "Confirmed", reasoning: "" }).severity).toBe("Medium");
    expect(applyVerification(base, { reachability: "Reachable", exploitability: "Easy", blastRadius: "High", verdict: "Confirmed", reasoning: "" }).severity).toBe("Critical");
    expect(applyVerification({ ...base, severity: "Critical" }, { reachability: "Reachable", exploitability: "Easy", blastRadius: "High", verdict: "Confirmed", reasoning: "" }).severity).toBe("Critical");
  });
});

describe("verifyFindings", () => {
  test("without a model, uses path heuristics: unreachable findings are capped, others stay needs-review", async () => {
    const out = await verifyFindings([base, { ...base, id: "f2", path: "tests/preview.test.ts" }], {});
    expect(out.kept.find((f) => f.id === "f1")!.verification.reachability).toBe("Reachable");
    expect(out.kept.find((f) => f.id === "f1")!.verification.verdict).toBe("Needs review");
    expect(out.kept.find((f) => f.id === "f2")!.severity).toBe("Low");
    expect(out.rejected).toEqual([]);
  });

  test("with a model, applies its verdicts and separates rejected findings", async () => {
    const verdicts: Record<string, any> = {
      f1: { reachability: "Reachable", exploitability: "Easy", blastRadius: "High", verdict: "Confirmed", reasoning: "Metadata endpoint reachable." },
      f2: { reachability: "Reachable", exploitability: "Not exploitable", blastRadius: "Low", verdict: "Rejected", reasoning: "Input is validated upstream." },
    };
    const out = await verifyFindings([base, { ...base, id: "f2" }], { verify: async (f) => verdicts[f.id] });
    expect(out.kept.map((f) => [f.id, f.severity])).toEqual([["f1", "Critical"]]);
    expect(out.rejected.map((f) => f.id)).toEqual(["f2"]);
  });

  test("a verifier failure leaves the finding as needs review instead of dropping it", async () => {
    const out = await verifyFindings([base], { verify: async () => { throw new Error("boom"); } });
    expect(out.kept).toHaveLength(1);
    expect(out.kept[0]!.verification.verdict).toBe("Needs review");
  });
});

describe("excerpt", () => {
  test("returns the whole file numbered when it is small, and a window around the line when it is large", () => {
    expect(excerpt("a\nb\nc", 2)).toBe("    1 | a\n    2 | b\n    3 | c");
    const big = Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join("\n");
    const w = excerpt(big, 250, 3, 1000);
    expect(w).toBe("  247 | line 247\n  248 | line 248\n  249 | line 249\n  250 | line 250\n  251 | line 251\n  252 | line 252\n  253 | line 253");
  });
});
