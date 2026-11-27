import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parseUnifiedDiff } from "../../src/core/diff.js";
import { semanticChanges, semanticChangesForDiff } from "../../src/understand/semantic.js";

const diff = readFileSync(new URL("../fixtures/invitations.diff", import.meta.url), "utf8");
const files = parseUnifiedDiff(diff);
const byPath = (p: string) => files.find((f) => f.path === p)!;

describe("semanticChanges", () => {
  test("detects added exported functions with their line", () => {
    const out = semanticChanges(byPath("src/server/auth/permissions.ts"));
    expect(out).toContainEqual({ kind: "added", symbolKind: "function", symbol: "canInviteMembers", line: 31, exported: true });
  });

  test("detects a modified function body as a modification of the enclosing symbol", () => {
    const out = semanticChanges(byPath("src/server/auth/permissions.ts"));
    expect(out).toContainEqual({ kind: "modified", symbolKind: "function", symbol: "canRemoveMember", line: 23, exported: true });
  });

  test("detects classes, non-exported functions and prisma models", () => {
    const svc = semanticChanges(byPath("src/server/invitations/invitationService.ts")).filter((c) => c.symbolKind !== "import");
    expect(svc.map((c) => c.symbol)).toEqual(["createInvitation", "listInvitations", "acceptInvitation", "InvitationError", "isExpired"]);
    expect(svc.find((c) => c.symbol === "InvitationError")!.symbolKind).toBe("class");
    expect(svc.find((c) => c.symbol === "isExpired")!.exported).toBe(false);
    expect(semanticChanges(byPath("prisma/schema.prisma"))).toContainEqual({ kind: "added", symbolKind: "model", symbol: "Invitation", line: 43, exported: true });
  });

  test("detects imports as dependencies", () => {
    const router = semanticChanges(byPath("src/server/invitations/invitationRouter.ts"));
    expect(router).toContainEqual({ kind: "added", symbolKind: "import", symbol: "../auth/permissions", line: 2, exported: false });
  });

  test("reports nothing for docs", () => {
    expect(semanticChanges(byPath("docs/invitations.md"))).toEqual([]);
  });
});

describe("semanticChangesForDiff", () => {
  test("groups by file and skips files with no symbols", () => {
    const all = semanticChangesForDiff(files);
    expect(Object.keys(all)).not.toContain("docs/invitations.md");
    expect(all["src/web/members/InviteDialog.tsx"]!.some((c) => c.symbol === "InviteDialog" && c.symbolKind === "function")).toBe(true);
  });
});
