import { describe, expect, test } from "vitest";
import { applyView, BUILT_IN_VIEWS, groupByPriority, resolveView, type TriageItem, type SavedView } from "../../src/triage/views.js";

function item(overrides: Partial<TriageItem["signals"]> & { priority?: TriageItem["assessment"]["priority"]; risk?: TriageItem["assessment"]["risk"]; nextAction?: TriageItem["assessment"]["nextAction"]; tags?: string[]; score?: number }): TriageItem {
  const { priority = "P2", risk = "Low", nextAction = "Needs human review", tags = [], score = 50, ...signals } = overrides;
  return {
    signals: {
      repo: "acme/platform", number: 1, title: "t", author: "casey", authorIsBot: false, isDraft: false,
      createdAt: new Date(), updatedAt: new Date(), baseRef: "main", additions: 1, deletions: 1, files: ["a.ts"],
      labels: [], requestedReviewers: [], reviews: [], ciStatus: "success", ...signals,
    },
    assessment: {
      priority, priorityLabel: "x", risk, reviewDepth: "Quick review", complexity: "Low", effort: "Low", blastRadius: "Low",
      nextAction, tags, why: "w", score, suggestedReviewers: [],
    },
  };
}

const items = [
  item({ number: 1, author: "me", priority: "P1", score: 70 }),
  item({ number: 2, requestedReviewers: ["me"], priority: "P0", score: 90 }),
  item({ number: 3, nextAction: "Safe to merge", priority: "P2", score: 30 }),
  item({ number: 4, authorIsBot: true, tags: ["Agent-created"], priority: "P0", score: 95 }),
  item({ number: 5, risk: "High", files: ["auth/x.ts"], priority: "P1", score: 80 }),
  item({ number: 6, baseRef: "release/2026.11", priority: "P2", score: 40 }),
];

describe("built-in views", () => {
  test("all, needs my review, authored by me, safe to merge", () => {
    const me = "me";
    expect(applyView(items, resolveView("all", []), me).map((i) => i.signals.number)).toEqual([4, 2, 5, 1, 6, 3]);
    expect(applyView(items, resolveView("needs-my-review", []), me).map((i) => i.signals.number)).toEqual([2]);
    expect(applyView(items, resolveView("authored-by-me", []), me).map((i) => i.signals.number)).toEqual([1]);
    expect(applyView(items, resolveView("safe-to-merge", []), me).map((i) => i.signals.number)).toEqual([3]);
  });

  test("exposes the built-in view list in display order", () => {
    expect(BUILT_IN_VIEWS.map((v) => v.id)).toEqual(["all", "needs-my-review", "authored-by-me", "safe-to-merge"]);
  });
});

describe("saved views", () => {
  const saved: SavedView[] = [
    { id: "security-watch", name: "Security watch", filter: { risk: ["High"], paths: ["auth/**", "**/secrets/**"] } },
    { id: "release-train", name: "Release train", filter: { baseBranches: ["release/*"] } },
    { id: "agent-prs", name: "Agent-created PRs", filter: { tags: ["Agent-created"] } },
  ];

  test("filters by risk or path, by base branch glob, and by tag", () => {
    expect(applyView(items, resolveView("security-watch", saved), "me").map((i) => i.signals.number)).toEqual([5]);
    expect(applyView(items, resolveView("release-train", saved), "me").map((i) => i.signals.number)).toEqual([6]);
    expect(applyView(items, resolveView("agent-prs", saved), "me").map((i) => i.signals.number)).toEqual([4]);
  });

  test("an unknown view id falls back to all", () => {
    expect(resolveView("nope", saved).id).toBe("all");
  });
});

describe("groupByPriority", () => {
  test("groups into P0..P3 buckets with labels and counts, highest score first inside each", () => {
    const groups = groupByPriority(items);
    expect(groups.map((g) => [g.priority, g.label, g.items.length])).toEqual([
      ["P0", "Urgent", 2], ["P1", "High priority", 2], ["P2", "Medium priority", 2],
    ]);
    expect(groups[0]!.items.map((i) => i.signals.number)).toEqual([4, 2]);
  });
});
