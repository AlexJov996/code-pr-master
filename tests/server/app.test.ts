import { Webhooks } from "@octokit/webhooks";
import { describe, expect, test } from "vitest";
import { createApp } from "../../src/server/app.js";

const secret = "test-secret";

async function post(app: ReturnType<typeof createApp>, event: string, payload: object, sign = true) {
  const body = JSON.stringify(payload);
  const wh = new Webhooks({ secret });
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-github-event": event,
    "x-github-delivery": "d1",
    "x-hub-signature-256": sign ? await wh.sign(body) : "sha256=bad",
  };
  return app.request("/api/webhooks/github", { method: "POST", headers, body });
}

describe("webhook server", () => {
  test("answers health checks", async () => {
    const app = createApp({ webhookSecret: secret, onPullRequest: async () => {}, onIssueComment: async () => {} });
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
  });

  test("rejects a request with a bad signature", async () => {
    let called = false;
    const app = createApp({ webhookSecret: secret, onPullRequest: async () => { called = true; }, onIssueComment: async () => {} });
    const res = await post(app, "pull_request", { action: "opened" }, false);
    expect(res.status).toBe(401);
    expect(called).toBe(false);
  });

  test("dispatches a signed pull_request event and acknowledges quickly", async () => {
    const seen: any[] = [];
    let resolveDone!: () => void;
    const done = new Promise<void>((r) => { resolveDone = r; });
    const app = createApp({ webhookSecret: secret, onPullRequest: async (p) => { seen.push(p); resolveDone(); }, onIssueComment: async () => {} });
    const res = await post(app, "pull_request", { action: "opened", number: 1 });
    expect(res.status).toBe(202);
    await done;
    expect(seen[0].action).toBe("opened");
  });

  test("dispatches issue_comment events and ignores unknown events", async () => {
    const seen: string[] = [];
    const app = createApp({ webhookSecret: secret, onPullRequest: async () => { seen.push("pr"); }, onIssueComment: async () => { seen.push("comment"); } });
    expect((await post(app, "issue_comment", { action: "created" })).status).toBe(202);
    expect((await post(app, "star", { action: "created" })).status).toBe(204);
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toEqual(["comment"]);
  });
});

describe("dashboard token", () => {
  function appWith(dashboardToken: string | undefined) {
    let loads = 0;
    const app = createApp({
      webhookSecret: secret, onPullRequest: async () => {}, onIssueComment: async () => {}, dashboardToken,
      secure: { load: async () => { loads++; throw new Error("stop here"); } },
    });
    return { app, loads: () => loads };
  }

  test("without a token every page is open", async () => {
    const { app, loads } = appWith(undefined);
    const res = await app.request("/api/secure.json?repo=acme/platform");
    expect(res.status).not.toBe(401);
    expect(loads()).toBe(1);
  });

  test("with a token, pages need it as a bearer header or cookie, and the health check stays open", async () => {
    const { app, loads } = appWith("s3cret");
    expect((await app.request("/healthz")).status).toBe(200);
    expect((await app.request("/api/secure.json?repo=acme/platform")).status).toBe(401);
    expect((await app.request("/api/secure.json?repo=acme/platform", { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
    expect(loads()).toBe(0);
    expect((await app.request("/api/secure.json?repo=acme/platform", { headers: { authorization: "Bearer s3cret" } })).status).not.toBe(401);
    expect((await app.request("/api/secure.json?repo=acme/platform", { headers: { cookie: "carrot_dashboard=s3cret" } })).status).not.toBe(401);
    expect(loads()).toBe(2);
  });

  test("?token= sets the cookie once and redirects to the clean URL", async () => {
    const { app, loads } = appWith("s3cret");
    const res = await app.request("/secure?repo=acme/platform&token=s3cret");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/secure?repo=acme%2Fplatform");
    expect(res.headers.get("set-cookie")).toMatch(/carrot_dashboard=s3cret.*HttpOnly/);
    expect(loads()).toBe(0);
    expect((await app.request("/secure?token=wrong")).status).toBe(401);
  });

  test("the webhook still works with a token configured", async () => {
    let called = false;
    let resolveDone!: () => void;
    const done = new Promise<void>((r) => { resolveDone = r; });
    const app = createApp({ webhookSecret: secret, onPullRequest: async () => { called = true; resolveDone(); }, onIssueComment: async () => {}, dashboardToken: "s3cret" });
    expect((await post(app, "pull_request", { action: "opened", number: 1 })).status).toBe(202);
    await done;
    expect(called).toBe(true);
  });
});
