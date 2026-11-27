import { existsSync, promises as fs } from "node:fs";
import { join, relative } from "node:path";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright-core";
import type { Finding, FindingOutput, Journey, JourneyRun, LogEntry, NetEntry, Step, StepResult, Target, VerifyRun } from "./schema.js";

const CHROME_CANDIDATES = [
  process.env.CARROT_CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

/** A Chrome or Chromium executable on this machine, or undefined. */
export function findChrome(): string | undefined {
  return CHROME_CANDIDATES.find((p): p is string => Boolean(p) && existsSync(p!));
}

export interface RunOptions {
  baseUrl: string;
  outDir: string;
  executablePath?: string;
  headless?: boolean;
  revision?: string;
  stepTimeoutMs?: number;
  viewport?: { width: number; height: number };
  /** Optional model pass that rewrites the deterministic finding into clearer language. */
  explain?: (run: JourneyRun, pageText: string) => Promise<FindingOutput>;
  log?: (msg: string) => void;
}

export function describeStep(s: Step): string {
  const t = s.target;
  const where = t ? (t.role ? `${t.role} "${t.name ?? ""}"` : t.text ? `text "${t.text}"` : t.label ? `label "${t.label}"` : t.placeholder ? `placeholder "${t.placeholder}"` : t.testId ? `test id "${t.testId}"` : t.selector ? `selector ${t.selector}` : "") : "";
  switch (s.action) {
    case "goto": return `goto ${s.url ?? "/"}`;
    case "click": case "check": case "expect_visible": return `${s.action} ${where}`;
    case "fill": case "select": return `${s.action} ${where} with "${s.value ?? ""}"`;
    case "press": return `press "${s.value ?? ""}"${where ? ` on ${where}` : ""}`;
    case "wait": return `wait ${s.value ?? "0"}ms`;
    case "expect_no_errors": return "expect no errors";
    default: return `${s.action} "${s.value ?? t?.text ?? ""}"`;
  }
}

/** A step URL resolved against the app under test. Absolute URLs must stay on that origin: the bot's browser never visits anything else. */
export function resolveUrl(baseUrl: string, u: string): string {
  const base = new URL(baseUrl);
  const target = /^https?:\/\//.test(u) ? new URL(u) : new URL(u.startsWith("/") ? u : `/${u}`, base);
  if (target.origin !== base.origin) throw new Error(`Refusing to navigate to ${target.origin}: journeys may only visit the application's own origin (${base.origin}).`);
  return target.href;
}

/** Does `href` satisfy an `expect_url` of `want`? A path matches itself and its children; a full URL matches by prefix. */
export function urlMatches(want: string, href: string): boolean {
  if (/^https?:\/\//.test(want)) return href.startsWith(want);
  const path = new URL(href).pathname;
  const base = want.replace(/\/+$/, "");
  if (base === "") return path === "/";
  return path === base || path.startsWith(`${base}/`);
}

/** The text an expect_text / expect_not_text step looks for: its value, or a text target. */
export function expectedText(step: Step): string {
  const text = step.value ?? step.target?.text;
  if (!text) throw new Error(`The ${step.action} step needs the text to look for (value or target.text).`);
  return text;
}

function locate(page: Page, t: Target | undefined): Locator {
  if (!t) throw new Error("This step needs a target.");
  if (t.role) return page.getByRole(t.role as Parameters<Page["getByRole"]>[0], t.name ? { name: t.name } : undefined).first();
  if (t.label) return page.getByLabel(t.label).first();
  if (t.placeholder) return page.getByPlaceholder(t.placeholder).first();
  if (t.testId) return page.getByTestId(t.testId).first();
  if (t.text) return page.getByText(t.text).first();
  if (t.selector) return page.locator(t.selector).first();
  throw new Error("Empty target.");
}

async function visibleText(page: Page, max = 600): Promise<string> {
  try {
    const text = (await page.evaluate("document.body ? document.body.innerText : ''")) as string;
    return text.replace(/\s+/g, " ").trim().slice(0, max);
  } catch {
    return "";
  }
}

interface Counters { consoleErrors: number; pageErrors: number; serverErrors: number }

async function execute(page: Page, step: Step, baseUrl: string, timeout: number, counters: Counters, since: Counters): Promise<void> {
  const url = (u: string) => resolveUrl(baseUrl, u);
  switch (step.action) {
    case "goto": await page.goto(url(step.url ?? "/"), { timeout, waitUntil: "load" }); return;
    case "click": await locate(page, step.target).click({ timeout }); await page.waitForLoadState("load", { timeout }).catch(() => {}); return;
    case "fill": await locate(page, step.target).fill(step.value ?? "", { timeout }); return;
    case "press": if (step.target) await locate(page, step.target).press(step.value ?? "Enter", { timeout }); else await page.keyboard.press(step.value ?? "Enter"); return;
    case "select": await locate(page, step.target).selectOption(step.value ?? "", { timeout }); return;
    case "check": await locate(page, step.target).check({ timeout }); return;
    case "expect_visible": await locate(page, step.target).waitFor({ state: "visible", timeout }); return;
    case "expect_text": {
      const text = expectedText(step);
      try { await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout }); }
      catch { throw new Error(`Expected text "${text}" to be visible. Page shows: ${await visibleText(page)}`); }
      return;
    }
    case "expect_not_text": {
      const text = expectedText(step);
      const l = page.getByText(text, { exact: false }).first();
      await page.waitForTimeout(Math.min(500, timeout));
      if (await l.isVisible().catch(() => false)) throw new Error(`Expected text "${text}" to be absent, but it is visible.`);
      return;
    }
    case "expect_url": {
      const want = step.value ?? step.url ?? "/";
      try { await page.waitForURL((u) => urlMatches(want, u.href), { timeout }); }
      catch { throw new Error(`Expected URL ${want}, but the page is at ${page.url()}.`); }
      return;
    }
    case "expect_no_errors": {
      const problems: string[] = [];
      if (counters.consoleErrors > since.consoleErrors) problems.push(`${counters.consoleErrors - since.consoleErrors} console error(s)`);
      if (counters.pageErrors > since.pageErrors) problems.push(`${counters.pageErrors - since.pageErrors} uncaught exception(s)`);
      if (counters.serverErrors > since.serverErrors) problems.push(`${counters.serverErrors - since.serverErrors} server error response(s)`);
      if (problems.length) throw new Error(`Expected no errors, but saw ${problems.join(", ")}.`);
      return;
    }
    case "wait": await page.waitForTimeout(Number(step.value ?? 0)); return;
  }
}

const GUIDANCE: Partial<Record<Step["action"], string>> = {
  expect_text: "Compare what the page renders at this URL with the expected text; the state that produces it is wrong or missing.",
  expect_not_text: "The page still shows text that should be gone; check the state transition that should remove it.",
  expect_url: "The navigation did not reach the expected route; check the redirect or the form action.",
  expect_no_errors: "Open the console and server logs for the request that produced the error.",
  click: "The control could not be found or clicked; check the accessible name and whether the element is rendered in this state.",
  fill: "The field could not be found; check its label, placeholder or name.",
};

function deterministicFinding(journey: Journey, failed: StepResult, pageText: string): Finding {
  const prev = failed.index > 0 ? ` after step ${failed.index} (${describeStep(journey.steps[failed.index - 1]!)})` : "";
  return {
    title: `${journey.title}: ${describeStep(failed.step)} failed`,
    expected: journey.expected ?? describeStep(failed.step),
    observed: `${failed.error ?? "Step failed."}${failed.url ? ` At ${failed.url}${prev}.` : ""}${pageText && !(failed.error ?? "").includes("Page shows") ? ` Page shows: ${pageText}` : ""}`,
    guidance: GUIDANCE[failed.step.action] ?? "Reproduce the steps and inspect the application state at the failing step.",
    stepIndex: failed.index,
  };
}

const isNavigationFailure = (err: string) => /net::ERR|ECONNREFUSED|Timeout .*goto|page\.goto/i.test(err);

async function runOne(browser: Browser, journey: Journey, opts: RunOptions, runDir: string): Promise<JourneyRun> {
  const jdir = join(runDir, journey.id);
  await fs.mkdir(jdir, { recursive: true });
  const timeout = opts.stepTimeoutMs ?? 10_000;
  const started = Date.now();
  const logs: LogEntry[] = [];
  const network: NetEntry[] = [];
  const counters: Counters = { consoleErrors: 0, pageErrors: 0, serverErrors: 0 };
  const context: BrowserContext = await browser.newContext({ viewport: opts.viewport ?? { width: 1280, height: 720 }, recordVideo: { dir: jdir, size: opts.viewport ?? { width: 1280, height: 720 } } });
  const page = await context.newPage();
  page.on("console", (m) => { logs.push({ ts: Date.now() - started, level: m.type(), text: m.text().slice(0, 2000) }); if (m.type() === "error") counters.consoleErrors++; });
  page.on("pageerror", (e) => { logs.push({ ts: Date.now() - started, level: "pageerror", text: String(e.message).slice(0, 2000) }); counters.pageErrors++; });
  page.on("response", (r) => { const s = r.status(); network.push({ ts: Date.now() - started, method: r.request().method(), url: r.url(), status: s }); if (s >= 500) counters.serverErrors++; });
  page.on("requestfailed", (r) => network.push({ ts: Date.now() - started, method: r.method(), url: r.url(), failed: true }));

  const steps: StepResult[] = [];
  const screenshots: string[] = [];
  let status: JourneyRun["status"] = "passed";
  let pageText = "";
  const since: Counters = { ...counters };
  for (let i = 0; i < journey.steps.length; i++) {
    const step = journey.steps[i]!;
    if (status !== "passed") { steps.push({ index: i, step, status: "skipped", durationMs: 0 }); continue; }
    const t0 = Date.now();
    const result: StepResult = { index: i, step, status: "passed", durationMs: 0 };
    try {
      await execute(page, step, opts.baseUrl, timeout, counters, since);
    } catch (err) {
      result.status = "failed";
      result.error = (err instanceof Error ? err.message : String(err)).split("\n")[0]!.slice(0, 1500);
      status = i === 0 && isNavigationFailure(result.error) ? "blocked" : "failed";
    }
    result.durationMs = Date.now() - t0;
    result.url = page.url();
    const shot = `${journey.id}/step-${String(i + 1).padStart(2, "0")}.png`;
    try { await page.screenshot({ path: join(runDir, shot), fullPage: false }); result.screenshot = shot; screenshots.push(shot); } catch { /* page may be gone */ }
    if (result.status === "failed") pageText = await visibleText(page);
    steps.push(result);
    opts.log?.(`${journey.id} · ${describeStep(step)} · ${result.status}${result.error ? ` · ${result.error}` : ""}`);
  }

  const video = page.video();
  await context.close();
  let recording: string | undefined;
  try {
    const p = await video?.path();
    if (p) { const dest = join(jdir, "recording.webm"); await fs.rename(p, dest); recording = relative(runDir, dest); }
  } catch { /* no video */ }

  const run: JourneyRun = { journey, status, startedAt: new Date(started).toISOString(), durationMs: Date.now() - started, steps, evidence: { screenshots, recording, logs, network } };
  const failed = steps.find((s) => s.status === "failed");
  if (failed && status === "failed") {
    run.finding = deterministicFinding(journey, failed, pageText);
    if (opts.explain) {
      try { const ai = await opts.explain(run, pageText); run.finding = { ...ai, stepIndex: failed.index }; } catch (err) { opts.log?.(`finding explanation failed: ${err instanceof Error ? err.message : String(err)}`); }
    }
  }
  return run;
}

/** Run journeys in a real browser and keep screenshots, a recording and logs per journey under outDir/<runId>. */
export async function runJourneys(journeys: readonly Journey[], opts: RunOptions): Promise<VerifyRun> {
  const executablePath = opts.executablePath ?? findChrome();
  if (!executablePath) throw new Error("No Chrome or Chromium found. Install Google Chrome or set CARROT_CHROME to a browser executable.");
  const id = `run-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
  const dir = join(opts.outDir, id);
  await fs.mkdir(dir, { recursive: true });
  const browser = await chromium.launch({ executablePath, headless: opts.headless ?? true });
  const startedAt = new Date().toISOString();
  const runs: JourneyRun[] = [];
  try {
    for (const j of journeys) runs.push(await runOne(browser, j, opts, dir));
  } finally {
    await browser.close();
  }
  const viewport = opts.viewport ?? { width: 1280, height: 720 };
  const result: VerifyRun = {
    id, baseUrl: opts.baseUrl, revision: opts.revision, environment: { browser: `Chromium ${browser.version()}`, viewport: `${viewport.width}x${viewport.height}`, headless: opts.headless ?? true },
    startedAt, finishedAt: new Date().toISOString(), runs,
    summary: { passed: runs.filter((r) => r.status === "passed").length, failed: runs.filter((r) => r.status === "failed").length, blocked: runs.filter((r) => r.status === "blocked").length },
    dir,
  };
  await fs.writeFile(join(dir, "run.json"), JSON.stringify(result, null, 2));
  return result;
}
