import { describe, expect, test } from "vitest";
import { renderBoard } from "../../src/triage/board.js";
import { demoItems } from "../../src/triage/demo.js";
import { BUILT_IN_VIEWS, countsByView, resolveView } from "../../src/triage/views.js";

describe("demoItems", () => {
  test("provides a realistic spread of scored pull requests", () => {
    const items = demoItems(new Date("2026-11-27T12:00:00Z"));
    expect(items.length).toBeGreaterThanOrEqual(10);
    const priorities = new Set(items.map((i) => i.assessment.priority));
    expect(priorities.has("P0")).toBe(true);
    expect(priorities.has("P1")).toBe(true);
    expect(items.some((i) => i.assessment.tags.includes("Agent-created"))).toBe(true);
    expect(items.some((i) => i.assessment.nextAction === "Safe to merge")).toBe(true);
  });
});

describe("renderBoard", () => {
  const items = demoItems(new Date("2026-11-27T12:00:00Z"));
  const views = BUILT_IN_VIEWS;
  const html = renderBoard({
    repo: "acme/platform",
    me: "casey",
    items,
    view: resolveView("all", []),
    views,
    savedViews: [{ id: "security-watch", name: "Security watch", filter: { risk: ["High"] } }],
    counts: { ...countsByView(items, views, "casey"), "security-watch": 3 },
    generatedAt: new Date("2026-11-27T12:00:00Z"),
  });

  test("is a complete HTML document with the repository in the title", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>Triage · acme/platform</title>");
  });

  test("renders view tabs with counts and saved views", () => {
    expect(html).toContain('href="?repo=acme%2Fplatform&amp;view=needs-my-review"');
    expect(html).toMatch(/Needs my review<\/span>\s*<span class="count">\d+<\/span>/);
    expect(html).toContain("Security watch");
    expect(html).toContain('<span class="count">3</span>');
  });

  test("groups cards under priority headings with counts", () => {
    expect(html).toMatch(/P0<\/span>\s*<span class="group-label">Urgent<\/span>\s*<span class="count">\d+<\/span>/);
  });

  test("renders a card with number, repo, title, why line, badges and author", () => {
    const first = items[0]!;
    expect(html).toContain(`#${first.signals.number}`);
    expect(html).toContain(first.signals.title);
    expect(html).toContain(first.assessment.why);
    expect(html).toContain(`${first.assessment.risk} risk`);
    expect(html).toContain(first.assessment.reviewDepth);
    expect(html).toContain(`@${first.signals.author}`);
  });

  test("escapes HTML in untrusted fields", () => {
    const evil = { ...items[0]!, signals: { ...items[0]!.signals, number: 999, title: "<script>alert(1)</script>" } };
    const out = renderBoard({ repo: "acme/platform", items: [evil], view: resolveView("all", []), views, savedViews: [], counts: {}, generatedAt: new Date() });
    expect(out).not.toContain("<script>alert(1)</script>");
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  test("shows an empty state when the view has no items", () => {
    const out = renderBoard({ repo: "acme/platform", items: [], view: resolveView("safe-to-merge", []), views, savedViews: [], counts: {}, generatedAt: new Date() });
    expect(out).toContain("Nothing in this view");
  });
});
