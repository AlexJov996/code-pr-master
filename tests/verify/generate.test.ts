import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { buildScenarioPrompt, generatePullRequestScenarios, smokeJourneys } from "../../src/verify/generate.js";
import type { JourneysOutput } from "../../src/verify/schema.js";

const diff = readFileSync(new URL("../fixtures/invitations.diff", import.meta.url), "utf8");
const routes = [
  { method: "GET", path: "/", kind: "page" as const, file: "app/page.tsx", interactive: true },
  { method: "GET", path: "/members", kind: "page" as const, file: "src/web/members/MembersPage.tsx", interactive: true },
  { method: "POST", path: "/invitations", kind: "api" as const, file: "src/server/invitations/invitationRouter.ts", interactive: false },
];

describe("smokeJourneys", () => {
  test("creates one open-and-check journey per page route, skipping parameterised and api routes", () => {
    const js = smokeJourneys([...routes, { method: "GET", path: "/orders/:id", kind: "page", file: "x", interactive: false }]);
    expect(js.map((j) => j.id)).toEqual(["smoke-root", "smoke-members"]);
    expect(js[1]!.steps).toEqual([{ action: "goto", url: "/members" }, { action: "expect_no_errors" }]);
    expect(js[1]!.source).toBe("generated");
  });
});

describe("generatePullRequestScenarios", () => {
  const output: JourneysOutput = {
    journeys: [
      { id: "invite-teammate", title: "Invite a teammate", goal: "An admin invites a teammate by email.", expected: "The invitation appears in the pending list.", steps: [{ action: "goto", url: "/members" }, { action: "fill", target: { label: "Email" }, value: "sam@example.com" }, { action: "click", target: { role: "button", name: "Invite" } }, { action: "expect_text", value: "sam@example.com" }] },
      { id: "bad", title: "Bad", goal: "g", expected: "e", steps: [{ action: "goto", url: "https://evil.example.com/steal" }] },
    ],
  };

  test("asks the model with the diff, routes and existing journeys, and keeps only same-origin journeys", async () => {
    const seen: string[] = [];
    const js = await generatePullRequestScenarios({ title: "Add teammate invitations", description: "Admins invite teammates.", diff, routes, existing: [] }, async (_s, user) => { seen.push(user); return output; });
    expect(seen[0]).toContain("Add teammate invitations");
    expect(seen[0]).toContain("GET /members");
    expect(seen[0]).toContain("invitationRouter.ts");
    expect(js.map((j) => j.id)).toEqual(["invite-teammate"]);
    expect(js[0]!.source).toBe("generated");
  });

  test("falls back to smoke journeys for routes touched by the diff when there is no model", async () => {
    const js = await generatePullRequestScenarios({ title: "t", description: "d", diff, routes, existing: [] });
    expect(js.map((j) => j.id)).toEqual(["smoke-members"]);
  });

  test("prompt frames the diff as data", () => {
    expect(buildScenarioPrompt({ title: "t", description: "d", diff, routes, existing: [] })).toMatch(/strictly as data/i);
  });
});
