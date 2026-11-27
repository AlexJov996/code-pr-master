import { spawn, type ChildProcess } from "node:child_process";

export interface EnvironmentOptions {
  install?: string;
  start: string;
  /** Full URL to poll; its origin becomes the base URL unless readyFromOutput gives a port. */
  readyUrl?: string;
  /** Path to poll on the base URL derived from readyFromOutput. */
  readyPath?: string;
  /** Regex with one capture group for the port, matched against the app's output. */
  readyFromOutput?: RegExp;
  readyTimeoutMs?: number;
  cwd: string;
  env?: Record<string, string>;
  log?: (msg: string) => void;
}

export interface EnvironmentStep { name: string; status: "done" | "failed"; detail?: string }

export interface PreparedEnvironment {
  baseUrl: string;
  steps: EnvironmentStep[];
  output: string;
  stopped: boolean;
  stop: () => Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll until the URL answers with a 2xx or 3xx. */
export async function waitForReady(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status < 400) return;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await sleep(300);
  }
  throw new Error(`Application not ready at ${url} after ${timeoutMs}ms (${lastError}).`);
}

function run(cmd: string, cwd: string, env: Record<string, string> | undefined): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, { cwd, shell: true, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout?.on("data", (d) => { output += d; });
    child.stderr?.on("data", (d) => { output += d; });
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

function killTree(child: ChildProcess): void {
  if (!child.pid) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch { try { child.kill("SIGTERM"); } catch { /* gone */ } }
}

/** Install, start and wait for the application, the way a sandbox would, then hand back a base URL and a stop function. */
export async function prepareEnvironment(opts: EnvironmentOptions): Promise<PreparedEnvironment> {
  const log = opts.log ?? (() => {});
  const steps: EnvironmentStep[] = [];
  const timeout = opts.readyTimeoutMs ?? 60_000;
  let output = "";

  if (opts.install) {
    log(`install: ${opts.install}`);
    const r = await run(opts.install, opts.cwd, opts.env);
    output += r.output;
    steps.push({ name: "install dependencies", status: r.code === 0 ? "done" : "failed", detail: r.code === 0 ? undefined : `exit ${r.code}` });
    if (r.code !== 0) throw new Error(`Install failed (exit ${r.code}):\n${r.output.slice(-2000)}`);
  }

  log(`start: ${opts.start}`);
  const child = spawn(opts.start, { cwd: opts.cwd, shell: true, detached: true, env: { ...process.env, ...opts.env }, stdio: ["ignore", "pipe", "pipe"] });
  let stopped = false;
  const stop = async () => { if (stopped) return; stopped = true; killTree(child); await sleep(100); };
  let portFromOutput: string | undefined;
  const onData = (d: Buffer) => {
    output += d.toString();
    if (opts.readyFromOutput && !portFromOutput) { const m = output.match(opts.readyFromOutput); if (m?.[1]) portFromOutput = m[1]; }
  };
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
  steps.push({ name: "start the application", status: "done" });

  try {
    let baseUrl: string;
    if (opts.readyFromOutput) {
      const deadline = Date.now() + timeout;
      while (!portFromOutput && Date.now() < deadline && child.exitCode === null) await sleep(100);
      if (!portFromOutput) throw new Error(`Application not ready: no port seen in its output within ${timeout}ms.\n${output.slice(-2000)}`);
      baseUrl = `http://127.0.0.1:${portFromOutput}`;
      await waitForReady(baseUrl + (opts.readyPath ?? "/"), Math.max(1000, deadline - Date.now()));
    } else if (opts.readyUrl) {
      await waitForReady(opts.readyUrl, timeout);
      baseUrl = new URL(opts.readyUrl).origin;
    } else {
      throw new Error("prepareEnvironment needs readyUrl or readyFromOutput.");
    }
    steps.push({ name: "check application readiness", status: "done" });
    const env: PreparedEnvironment = { baseUrl, steps, output, stopped, stop: async () => { await stop(); env.stopped = true; } };
    return env;
  } catch (err) {
    steps.push({ name: "check application readiness", status: "failed", detail: err instanceof Error ? err.message : String(err) });
    await stop();
    throw err;
  }
}
