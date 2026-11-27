import { describe, expect, test } from "vitest";
import { createApp } from "../../src/server/app.js";
import { demoItems } from "../../src/triage/demo.js";

const base = { webhookSecret: "s", onPullRequest: async () => {}, onIssueComment: async () => {} };

describe("triage routes", () => {
  const seen: string[] = [];
  const app = createApp({
    ...base,
    triage: {
      me: "casey",
      savedViews: [{ id: "release-train", name: "Release train", filter: { baseBranches: ["release/*"] } }],
      load: async (repo) => { seen.push(repo); return demoItems(new Date("2026-11-27T12:00:00Z")); },
    },
  });

  test("renders the board for a repository", async () => {
    const res = await app.request("/triage?repo=acme/platform");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Triage · acme/platform");
    expect(html).toContain("Release train");
    expect(seen).toEqual(["acme/platform"]);
  });

  test("applies the selected view", async () => {
    const html = await (await app.request("/triage?repo=acme/platform&view=safe-to-merge")).text();
    expect(html).toContain('class="tab active"');
    expect(html).toContain("Safe to merge");
  });

  test("serves JSON for the same data", async () => {
    const res = await app.request("/api/triage.json?repo=acme/platform&view=all");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.repo).toBe("acme/platform");
    expect(body.groups[0].priority).toBe("P0");
    expect(body.groups[0].items[0].assessment.score).toBeGreaterThan(0);
  });

  test("asks for a repository when none is given and rejects a malformed one", async () => {
    expect((await app.request("/triage")).status).toBe(400);
    expect((await app.request("/triage?repo=nope")).status).toBe(400);
  });

  test("returns 404 when triage is not configured", async () => {
    const bare = createApp(base);
    expect((await bare.request("/triage?repo=a/b")).status).toBe(404);
  });
});
