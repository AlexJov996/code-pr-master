import { describe, expect, test } from "vitest";
import { scorePullRequest, type PullRequestSignals } from "../../src/triage/score.js";

const now = new Date("2026-11-27T12:00:00Z");

function pr(overrides: Partial<PullRequestSignals> = {}): PullRequestSignals {
  return {
    repo: "acme/platform",
    number: 1,
    title: "feat(ui): add settings panel",
    author: "casey",
    authorIsBot: false,
    isDraft: false,
    createdAt: new Date("2026-11-27T10:00:00Z"),
    updatedAt: new Date("2026-11-27T11:00:00Z"),
    baseRef: "main",
    additions: 40,
    deletions: 10,
    files: ["src/ui/settings.tsx"],
    labels: [],
    requestedReviewers: [],
    reviews: [],
    ciStatus: "success",
    ...overrides,
  };
}

describe("scorePullRequest: risk and depth", () => {
  test("a small UI change is low risk, quick review, low everything", () => {
    const a = scorePullRequest(pr(), { now });
    expect(a.risk).toBe("Low");
    expect(a.reviewDepth).toBe("Quick review");
    expect(a.complexity).toBe("Low");
    expect(a.effort).toBe("Low");
    expect(a.blastRadius).toBe("Low");
    expect(a.priority).toBe("P2");
  });

  test("touching auth or secrets is high risk and needs a deep review", () => {
    const a = scorePullRequest(pr({ title: "fix(auth): rotate signing key", files: ["services/auth/keys.ts"] }), { now });
    expect(a.risk).toBe("High");
    expect(a.reviewDepth).toBe("Deep review");
    expect(a.priority).toBe("P0");
  });

  test("a large change is complex and high effort, standard review when risk is medium", () => {
    const a = scorePullRequest(pr({ additions: 600, deletions: 120, files: ["src/a.ts", "src/b.ts", "lib/c.ts", "docs/d.md"] }), { now });
    expect(a.complexity).toBe("High");
    expect(a.effort).toBe("High");
    expect(a.reviewDepth).toBe("Standard review");
  });

  test("blast radius grows with the spread across top-level areas and shared code", () => {
    expect(scorePullRequest(pr({ files: ["a/x.ts", "b/y.ts", "c/z.ts"] }), { now }).blastRadius).toBe("High");
    expect(scorePullRequest(pr({ files: ["a/x.ts", "b/y.ts"] }), { now }).blastRadius).toBe("Medium");
    expect(scorePullRequest(pr({ files: ["packages/core/x.ts"] }), { now }).blastRadius).toBe("High");
  });

  test("docs-only changes are low priority and quick", () => {
    const a = scorePullRequest(pr({ title: "docs: fix typo", files: ["README.md", "docs/guide.md"] }), { now });
    expect(a.priority).toBe("P3");
    expect(a.reviewDepth).toBe("Quick review");
  });
});

describe("scorePullRequest: next action and why", () => {
  test("drafts need author action and can be reviewed later", () => {
    const a = scorePullRequest(pr({ isDraft: true }), { now });
    expect(a.nextAction).toBe("Needs author action");
    expect(a.reviewDepth).toBe("Review later");
  });

  test("failing CI or requested changes mean the author owns the next step", () => {
    expect(scorePullRequest(pr({ ciStatus: "failure" }), { now }).nextAction).toBe("Needs author action");
    expect(scorePullRequest(pr({ reviews: [{ author: "sam", state: "CHANGES_REQUESTED", submittedAt: new Date("2026-11-27T11:30:00Z") }] }), { now }).nextAction).toBe("Needs author action");
  });

  test("approved with green CI and low risk is safe to merge", () => {
    const a = scorePullRequest(pr({ reviews: [{ author: "sam", state: "APPROVED", submittedAt: new Date("2026-11-27T11:30:00Z") }] }), { now });
    expect(a.nextAction).toBe("Safe to merge");
    expect(a.why).toMatch(/safe to merge/i);
  });

  test("approved but high risk still needs a human", () => {
    const a = scorePullRequest(pr({ files: ["infra/terraform/prod.tf"], reviews: [{ author: "sam", state: "APPROVED", submittedAt: new Date("2026-11-27T11:30:00Z") }] }), { now });
    expect(a.nextAction).toBe("Needs human review");
  });

  test("a reviewer assigned and no review yet is waiting on that reviewer", () => {
    const a = scorePullRequest(pr({ requestedReviewers: ["sam"] }), { now });
    expect(a.nextAction).toBe("Reviewer assigned; waiting for review");
    expect(a.why).toMatch(/waiting for review/i);
  });

  test("nobody assigned and nothing reviewed asks for a reviewer once it is a day old", () => {
    const a = scorePullRequest(pr({ createdAt: new Date("2026-11-25T10:00:00Z"), updatedAt: new Date("2026-11-25T10:00:00Z") }), { now });
    expect(a.nextAction).toBe("Needs human review");
    expect(a.why).toMatch(/assign a reviewer/i);
  });

  test("fresh work says it is new and active", () => {
    expect(scorePullRequest(pr(), { now }).why).toMatch(/new, active work/i);
  });

  test("stale work waiting over three days flags coordination", () => {
    const a = scorePullRequest(pr({ createdAt: new Date("2026-11-20T10:00:00Z"), updatedAt: new Date("2026-11-20T10:00:00Z"), requestedReviewers: ["sam"] }), { now });
    expect(a.why).toMatch(/waiting and may need coordination/i);
  });
});

describe("scorePullRequest: tags and priority", () => {
  test("agent-created high-risk work is urgent and demands human judgment", () => {
    const a = scorePullRequest(pr({ author: "sentinel-agent[bot]", authorIsBot: true, title: "fix(auth): rotate exposed production signing key", files: ["auth/keys.ts"] }), { now });
    expect(a.tags).toContain("Agent-created");
    expect(a.priority).toBe("P0");
    expect(a.why).toMatch(/human judgment required/i);
  });

  test("tags bugfixes, new changes since the last review, and linked issue severity", () => {
    const a = scorePullRequest(pr({
      title: "fix(reviews): stop reporting success as failure",
      reviews: [{ author: "sam", state: "COMMENTED", submittedAt: new Date("2026-11-27T10:30:00Z") }],
      updatedAt: new Date("2026-11-27T11:00:00Z"),
      linkedIssueSeverity: "Medium",
    }), { now });
    expect(a.tags).toEqual(expect.arrayContaining(["Bugfix", "New changes since last review", "Issue severity: Medium"]));
  });

  test("a hotfix label or critical linked issue is P0", () => {
    expect(scorePullRequest(pr({ labels: ["hotfix"] }), { now }).priority).toBe("P0");
    expect(scorePullRequest(pr({ linkedIssueSeverity: "Critical" }), { now }).priority).toBe("P0");
  });

  test("produces a numeric score that orders urgent work first", () => {
    const urgent = scorePullRequest(pr({ files: ["auth/keys.ts"], labels: ["security"] }), { now });
    const routine = scorePullRequest(pr(), { now });
    const docs = scorePullRequest(pr({ files: ["README.md"] }), { now });
    expect(urgent.score).toBeGreaterThan(routine.score);
    expect(routine.score).toBeGreaterThan(docs.score);
  });
});

describe("scorePullRequest: calibration", () => {
  test("a docs-only change stays low risk even when its title mentions security", () => {
    const a = scorePullRequest(pr({ title: "Document repository tabs for security scan results", files: ["docs/security/tabs.md"] }), { now });
    expect(a.risk).toBe("Low");
    expect(a.priority).toBe("P3");
  });

  test("design tokens and ui keys are not secrets", () => {
    const a = scorePullRequest(pr({ title: "feat(theme): tasteful depth", files: ["packages/ui/theme.ts", "packages/ui/tokens.ts", "apps/web/keys.ts"] }), { now });
    expect(a.risk).not.toBe("High");
  });

  test("billing, iam and infra are high risk but P1, not P0", () => {
    for (const files of [["services/billing/periods.ts"], ["services/iam/roles.ts"], ["infra/terraform/prod.tf"]]) {
      const a = scorePullRequest(pr({ files }), { now });
      expect(a.risk, files[0]).toBe("High");
      expect(a.priority, files[0]).toBe("P1");
    }
  });

  test("a title that mentions a signing key or credentials raises risk to at least Medium", () => {
    const a = scorePullRequest(pr({ title: "fix: rotate the signing key used by the exporter", files: ["src/export/run.ts"] }), { now });
    expect(a.risk).toBe("Medium");
  });

  test("drafts are capped at P2 and work waiting on the author at P1", () => {
    expect(scorePullRequest(pr({ isDraft: true, files: ["auth/session.ts"] }), { now }).priority).toBe("P2");
    expect(scorePullRequest(pr({ ciStatus: "failure", files: ["auth/session.ts"] }), { now }).priority).toBe("P1");
    expect(scorePullRequest(pr({ isDraft: true, files: ["auth/session.ts"], labels: ["hotfix"] }), { now }).priority).toBe("P0");
  });
});
