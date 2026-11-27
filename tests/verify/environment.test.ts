import { describe, expect, test } from "vitest";
import { prepareEnvironment, waitForReady } from "../../src/verify/environment.js";

const serverScript = `const http=require('http');const s=http.createServer((q,r)=>{r.end('ok')});s.listen(0,'127.0.0.1',()=>{console.log('READY '+s.address().port)})`;

describe("prepareEnvironment", () => {
  test("runs the start command, waits for the ready URL, exposes the base URL, and stops the app", async () => {
    const env = await prepareEnvironment({
      start: `node -e "${serverScript.replace(/"/g, '\\"')}"`,
      readyFromOutput: /READY (\d+)/,
      readyPath: "/",
      readyTimeoutMs: 10_000,
      cwd: process.cwd(),
    });
    expect(env.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(env.steps.map((s) => [s.name, s.status])).toEqual([["start the application", "done"], ["check application readiness", "done"]]);
    const res = await fetch(env.baseUrl + "/");
    expect(await res.text()).toBe("ok");
    await env.stop();
    expect(env.stopped).toBe(true);
  }, 20_000);

  test("fails clearly when the app never becomes ready", async () => {
    await expect(prepareEnvironment({ start: "node -e \"setTimeout(()=>{},5000)\"", readyUrl: "http://127.0.0.1:1/", readyTimeoutMs: 800, cwd: process.cwd() })).rejects.toThrow(/not ready/i);
  }, 10_000);

  test("waitForReady polls until a 2xx", async () => {
    await expect(waitForReady("http://127.0.0.1:1/", 300)).rejects.toThrow(/not ready/i);
  });
});
