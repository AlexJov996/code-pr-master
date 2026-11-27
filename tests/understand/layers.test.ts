import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parseUnifiedDiff } from "../../src/core/diff.js";
import { heuristicLayers, layerStats, normalizeStack, orderLayers } from "../../src/understand/layers.js";
import type { ChangeStackOutput } from "../../src/understand/schema.js";

const diff = readFileSync(new URL("../fixtures/invitations.diff", import.meta.url), "utf8");
const files = parseUnifiedDiff(diff);

describe("heuristicLayers", () => {
  test("groups files into data, server, ui, tests and docs layers in that order", () => {
    const layers = heuristicLayers(files);
    expect(layers.map((l) => l.title)).toEqual(["Data model", "Server and API", "User interface", "Tests", "Documentation"]);
    expect(layers[0]!.files).toEqual(["prisma/schema.prisma"]);
    expect(layers[1]!.files).toEqual(expect.arrayContaining(["src/server/auth/permissions.ts", "src/server/invitations/invitationService.ts"]));
    expect(layers[2]!.files).toEqual(["src/web/members/InviteDialog.tsx", "src/web/members/MembersPage.tsx"]);
    expect(layers[1]!.dependsOn).toEqual([0]);
    expect(layers[2]!.dependsOn).toEqual([1]);
  });

  test("omits empty layers", () => {
    const only = heuristicLayers(files.filter((f) => f.path.startsWith("src/web")));
    expect(only.map((l) => l.title)).toEqual(["User interface"]);
    expect(only[0]!.dependsOn).toEqual([]);
  });
});

describe("normalizeStack", () => {
  const output: ChangeStackOutput = {
    title: "Add teammate invitations with roles",
    summary: "Adds an invitation model, API and UI.",
    layers: [
      { title: "Add the invitation API and emails", description: "Endpoints and the email.", files: ["src/server/invitations/invitationService.ts", "src/server/invitations/invitationRouter.ts", "src/server/email/invitation.ts", "src/server/auth/permissions.ts", "src/nonexistent.ts"], depends_on: ["Add the invitation data model"], risks: ["Token is logged in the email body."] },
      { title: "Add the invitation data model", description: "The Invitation table.", files: ["prisma/schema.prisma"], depends_on: [], risks: [] },
      { title: "Build the invite and members UI", description: "Dialog and page.", files: ["src/web/members/InviteDialog.tsx"], depends_on: ["Add the invitation API and emails", "Does not exist"], risks: [] },
    ],
    summaries: [
      { path: "src/server/invitations/invitationService.ts", start_line: 7, end_line: 13, symbol: "createInvitation", complexity: "High", summary: "Builds the token, sets a 7-day expiry, persists and emails." },
      { path: "src/server/invitations/invitationService.ts", start_line: 500, end_line: 510, symbol: "ghost", complexity: "Low", summary: "Out of range." },
      { path: "src/missing.ts", start_line: 1, end_line: 2, complexity: "Low", summary: "Missing file." },
    ],
    architecture: [{ from: "invitationRouter", to: "invitationService", label: "calls" }, { from: "invitationService", to: "email/invitation", label: "sends" }],
  };

  const stack = normalizeStack(output, files);

  test("orders layers so dependencies come first and numbers them", () => {
    expect(stack.layers.map((l) => l.title)).toEqual([
      "Add the invitation data model",
      "Add the invitation API and emails",
      "Build the invite and members UI",
      "Other changes",
    ]);
    expect(stack.layers[1]!.dependsOn).toEqual([0]);
    expect(stack.layers[2]!.dependsOn).toEqual([1]);
  });

  test("drops unknown files and collects unassigned files into a final layer", () => {
    expect(stack.layers[1]!.files).not.toContain("src/nonexistent.ts");
    expect(stack.layers[3]!.files).toEqual(expect.arrayContaining(["src/web/members/MembersPage.tsx", "src/server/invitations/invitationService.test.ts", "docs/invitations.md"]));
  });

  test("keeps only summaries whose range is inside the file's new-side lines", () => {
    expect(stack.summaries).toHaveLength(1);
    expect(stack.summaries[0]!.symbol).toBe("createInvitation");
    expect(stack.summaries[0]!.lines).toBe(7);
  });

  test("keeps risks and architecture edges", () => {
    expect(stack.layers[1]!.risks).toEqual(["Token is logged in the email body."]);
    expect(stack.architecture).toHaveLength(2);
  });
});

describe("layerStats", () => {
  test("sums additions and deletions, counts files, and flags security-sensitive paths", () => {
    const s = layerStats({ title: "x", description: "", files: ["src/server/auth/permissions.ts", "src/server/email/invitation.ts"], dependsOn: [], risks: [] }, files);
    expect(s.files).toBe(2);
    expect(s.additions).toBe(14);
    expect(s.deletions).toBe(1);
    expect(s.securitySensitive).toEqual(["src/server/auth/permissions.ts"]);
    expect(s.areas).toEqual(["src"]);
  });
});

describe("orderLayers", () => {
  test("breaks cycles by falling back to the given order", () => {
    const a = { title: "A", description: "", files: [], dependsOn: [1], risks: [] };
    const b = { title: "B", description: "", files: [], dependsOn: [0], risks: [] };
    expect(orderLayers([a, b]).map((l) => l.title)).toEqual(["A", "B"]);
  });
});
