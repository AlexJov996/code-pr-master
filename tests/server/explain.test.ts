import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { createApp } from "../../src/server/app.js";

const diff = readFileSync(new URL("../fixtures/invitations.diff", import.meta.url), "utf8");
const base = { webhookSecret: "s", onPullRequest: async () => {}, onIssueComment: async () => {} };

describe("explain routes", () => {
  const seen: string[] = [];
  const app = createApp({
    ...base,
    explain: {
      load: async (repo, number) => { seen.push(`${repo}#${number}`); return { title: "Add teammate invitations with roles", description: "Admins invite teammates.", diff }; },
    },
  });

  test("renders the change stack page for a pull request", async () => {
    const res = await app.request("/explain?repo=acme/web-app&pr=482");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Change Stack · acme/web-app #482");
    expect(html).toContain("src/server/invitations/invitationService.ts");
    expect(seen).toEqual(["acme/web-app#482"]);
  });

  test("serves the walkthrough as markdown and as json", async () => {
    const md = await app.request("/api/explain.md?repo=acme/web-app&pr=482");
    expect(md.status).toBe(200);
    expect(await md.text()).toContain("## Change stack");
    const json = await app.request("/api/explain.json?repo=acme/web-app&pr=482");
    const body = (await json.json()) as any;
    expect(body.stack.layers.length).toBeGreaterThan(1);
    expect(body.overview.files).toBe(9);
  });

  test("validates its parameters and reports an unconfigured feature", async () => {
    expect((await app.request("/explain?repo=acme/web-app")).status).toBe(400);
    expect((await app.request("/explain?repo=bad&pr=1")).status).toBe(400);
    expect((await app.request("/explain?repo=acme/web-app&pr=abc")).status).toBe(400);
    expect((await createApp(base).request("/explain?repo=a/b&pr=1")).status).toBe(404);
  });
});
