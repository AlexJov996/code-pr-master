import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { explainChanges } from "../../src/understand/explain.js";
import { EXPLAIN_MARKER, renderExplainMarkdown, renderExplainPage, renderMermaid } from "../../src/understand/render.js";

const diff = readFileSync(new URL("../fixtures/invitations.diff", import.meta.url), "utf8");
const input = { title: "Add teammate invitations with roles", description: "Admins can invite teammates.", diff };

describe("renderMermaid", () => {
  test("draws architecture edges as a flowchart with safe ids", async () => {
    const r = await explainChanges(input, {});
    const m = renderMermaid(r);
    expect(m.startsWith("flowchart LR")).toBe(true);
    expect(m).toMatch(/\["src\/server\/invitations\/invitationRouter\.ts"\]/);
    expect(m).toMatch(/-->\|imports\|/);
    expect(m).not.toMatch(/[^\w\s"\[\]|>():.\-\/]/);
  });

  test("falls back to the layer graph when there are no edges", async () => {
    const r = await explainChanges({ ...input, diff: diff.split("diff --git a/src/web/members/MembersPage.tsx")[0]! }, {});
    const noEdges = { ...r, stack: { ...r.stack, architecture: [] } };
    const m = renderMermaid(noEdges);
    expect(m).toContain('L0["01 Data model"]');
    expect(m).toContain("L0 --> L1");
  });
});

describe("renderExplainMarkdown", () => {
  test("renders a marker, title, layered walkthrough, summaries table and a mermaid block", async () => {
    const r = await explainChanges(input, {});
    const md = renderExplainMarkdown(r);
    expect(md.startsWith(EXPLAIN_MARKER)).toBe(true);
    expect(md).toContain("# Add teammate invitations with roles");
    expect(md).toContain("### 01 Data model");
    expect(md).toMatch(/### 02 Server and API · 4 files · \+\d+\/−\d+ · depends on 01/);
    expect(md).toContain("`src/server/auth/permissions.ts`");
    expect(md).toContain("modified `canRemoveMember`");
    expect(md).toContain("| Complexity | Region | Symbol | Summary |");
    expect(md).toContain("| 🟢 Low | `src/server/invitations/invitationService.ts:7-13` | `createInvitation` |");
    expect(md).toContain("```mermaid\nflowchart LR");
    expect(md).toContain("Blast radius");
  });
});

describe("renderExplainPage", () => {
  test("is a full page with layer navigation, file diffs, a context panel and the diagram", async () => {
    const r = await explainChanges(input, {});
    const html = renderExplainPage(r, { repo: "acme/web-app", number: 482 });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>Change Stack · acme/web-app #482</title>");
    expect(html).toContain('class="layer"');
    expect(html).toContain("Add teammate invitations with roles");
    expect(html).toContain("src/server/invitations/invitationService.ts");
    expect(html).toContain("Mark viewed");
    expect(html).toContain('class="mermaid"');
    expect(html).toContain("cdnjs.cloudflare.com/ajax/libs/mermaid/");
    expect(html).toContain("return member.role === &quot;ADMIN&quot;");
  });

  test("escapes untrusted text", async () => {
    const r = await explainChanges({ ...input, title: "<img src=x onerror=alert(1)>" }, {});
    const html = renderExplainPage(r, { repo: "a/b", number: 1 });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });
});
