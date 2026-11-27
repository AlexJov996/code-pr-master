import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { buildExplainUserPrompt, explainChanges, importEdges, EXPLAIN_SYSTEM } from "../../src/understand/explain.js";
import type { ChangeStackOutput } from "../../src/understand/schema.js";

const diff = readFileSync(new URL("../fixtures/invitations.diff", import.meta.url), "utf8");
const input = { title: "Add teammate invitations with roles", description: "Admins can invite teammates.", diff };

describe("prompt", () => {
  test("system prompt asks for layers, summaries and architecture; user prompt carries the diff and symbols", () => {
    expect(EXPLAIN_SYSTEM).toMatch(/layer/i);
    expect(EXPLAIN_SYSTEM).toMatch(/summar/i);
    const user = buildExplainUserPrompt(input);
    expect(user).toContain("Add teammate invitations with roles");
    expect(user).toContain("### src/server/invitations/invitationService.ts (added, +30/-0)");
    expect(user).toContain("createInvitation");
    expect(user).toMatch(/Symbols changed/i);
  });
});

describe("explainChanges without a model", () => {
  test("builds a heuristic stack with layers, region summaries from symbols, and import edges", async () => {
    const r = await explainChanges(input, {});
    expect(r.stack.source).toBe("heuristic");
    expect(r.stack.title).toBe("Add teammate invitations with roles");
    expect(r.stack.layers.map((l) => l.title)).toEqual(["Data model", "Server and API", "User interface", "Tests", "Documentation"]);
    expect(r.stack.summaries.some((s) => s.symbol === "createInvitation" && s.path.endsWith("invitationService.ts"))).toBe(true);
    const big = r.stack.summaries.find((s) => s.symbol === "createInvitation")!;
    expect(big.startLine).toBe(7);
    expect(big.endLine).toBe(13);
    expect(r.stack.architecture).toContainEqual({ from: "src/server/invitations/invitationRouter.ts", to: "src/server/auth/permissions.ts", label: "imports" });
  });

  test("computes per-layer stats and an overview", async () => {
    const r = await explainChanges(input, {});
    expect(r.layerStats[1]!.securitySensitive).toEqual(["src/server/auth/permissions.ts"]);
    expect(r.overview.files).toBe(9);
    expect(r.overview.additions).toBeGreaterThan(70);
    expect(r.overview.blastRadius).toBe("High");
    expect(r.overview.attention.some((a) => /security/i.test(a))).toBe(true);
  });
});

describe("explainChanges with a model", () => {
  const output: ChangeStackOutput = {
    title: "Add teammate invitations with roles",
    summary: "Adds the invitation model, API, email and UI.",
    layers: [
      { title: "Add the invitation data model", description: "Table.", files: ["prisma/schema.prisma"], depends_on: [], risks: [] },
      { title: "Add the invitation API and emails", description: "Endpoints.", files: ["src/server/invitations/invitationService.ts", "src/server/invitations/invitationRouter.ts", "src/server/email/invitation.ts", "src/server/auth/permissions.ts"], depends_on: ["Add the invitation data model"], risks: ["canRemoveMember now allows ADMIN, widening who can remove members."] },
      { title: "Build the invite and members UI", description: "Dialog.", files: ["src/web/members/InviteDialog.tsx", "src/web/members/MembersPage.tsx"], depends_on: ["Add the invitation API and emails"], risks: [] },
    ],
    summaries: [{ path: "src/server/invitations/invitationService.ts", start_line: 7, end_line: 13, symbol: "createInvitation", complexity: "High", summary: "Builds the token, sets a 7-day expiry, persists the row and sends the email." }],
    architecture: [],
  };

  test("uses the model's layers and summaries, and falls back to import edges when it gives no architecture", async () => {
    const calls: string[] = [];
    const r = await explainChanges(input, { generate: async (sys, user) => { calls.push(user); return output; } });
    expect(calls).toHaveLength(1);
    expect(r.stack.source).toBe("model");
    expect(r.stack.layers.map((l) => l.title)).toEqual(["Add the invitation data model", "Add the invitation API and emails", "Build the invite and members UI", "Other changes"]);
    expect(r.stack.summaries[0]!.complexity).toBe("High");
    expect(r.stack.architecture.length).toBeGreaterThan(0);
    expect(r.overview.attention).toContain("canRemoveMember now allows ADMIN, widening who can remove members.");
  });
});

describe("importEdges", () => {
  test("resolves relative imports to files inside the diff only", async () => {
    const r = await explainChanges(input, {});
    const edges = importEdges(r.files, r.semantic);
    expect(edges).toContainEqual({ from: "src/web/members/MembersPage.tsx", to: "src/web/members/InviteDialog.tsx", label: "imports" });
    expect(edges.some((e) => e.to === "node:crypto")).toBe(false);
  });
});
