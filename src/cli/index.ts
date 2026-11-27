import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import { writeFileSync } from "node:fs";
import { createClaudeGenerate, createDefaultClient, createStructuredGenerate, hasAnthropicCredential } from "../core/claude.js";
import { explainChanges } from "../understand/explain.js";
import { renderExplainMarkdown, renderExplainPage } from "../understand/render.js";
import { ChangeStackOutputSchema } from "../understand/schema.js";
import { CONFIG_FILENAMES, DEFAULT_CONFIG, parseConfig, PROFILES, type Config } from "../core/config.js";
import { renderTerminalReport } from "../core/format.js";
import { buildSystemPrompt, buildUserPrompt } from "../core/prompt.js";
import { reviewChanges } from "../core/review.js";
import { renderTerminalBoard } from "../triage/board.js";
import { createTriageLoader, savedViewsFrom } from "../triage/index.js";
import { applyView, groupByPriority, resolveView } from "../triage/views.js";
import { diffCommandFor, exitCodeFor, parseRepo, type FailOn } from "./options.js";
import { createSecurityDeps } from "../secure/index.js";
import { collectLocalFiles } from "../secure/local.js";
import { runDeepScan } from "../secure/pipeline.js";
import { buildPosture, renderPosturePage, renderScanMarkdown } from "../secure/posture.js";
import { scanDiff } from "../secure/scan.js";
import { SEVERITY_RANK, type SecSeverity } from "../secure/schema.js";
import { saveScan } from "../secure/store.js";

function loadLocalConfig(cwd: string): Config {
  for (const name of CONFIG_FILENAMES) {
    const p = resolve(cwd, name);
    if (existsSync(p)) return parseConfig(readFileSync(p, "utf8"));
  }
  return DEFAULT_CONFIG;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
}

function readDiff(opts: { diff?: string; base?: string; staged?: boolean; working?: boolean }, cwd: string): string {
  if (opts.diff) return opts.diff === "-" ? readFileSync(0, "utf8") : readFileSync(resolve(cwd, opts.diff), "utf8");
  const [, ...args] = diffCommandFor(opts);
  return git(cwd, args);
}

function gitLog(cwd: string, base: string): { title: string; description: string } {
  try {
    return { title: git(cwd, ["log", "-1", "--format=%s"]).trim(), description: git(cwd, ["log", "--format=%s%n%b", `${base}..HEAD`]).trim() };
  } catch {
    return { title: "", description: "" };
  }
}

function githubToken(): string | undefined {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try { return execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || undefined; } catch { return undefined; }
}

const program = new Command().name("carrot-review").description("CodeRabbit-style pull request tooling: AI reviews and a triage board.");

program
  .command("review", { isDefault: true })
  .description("Review a diff with Claude and print the report.")
  .option("-b, --base <ref>", "base ref to diff against (merge-base with HEAD)", "main")
  .option("-s, --staged", "review staged changes instead of a branch diff")
  .option("-w, --working", "review all uncommitted changes against HEAD")
  .option("-d, --diff <file>", "read a unified diff from a file ('-' for stdin)")
  .option("-t, --title <text>", "pull request title (defaults to the last commit subject)")
  .option("--description <text>", "pull request description (defaults to commit messages since base)")
  .option("-p, --profile <name>", `review profile: ${PROFILES.join(", ")}`)
  .option("-m, --model <id>", "Claude model id (overrides config)")
  .option("--fail-on <severity>", "exit 1 when a finding is at or above: critical, major, minor, none", "none")
  .option("--json", "print the raw review result as JSON")
  .option("--dry-run", "print the prompts that would be sent and exit without calling the model")
  .option("-C, --cwd <dir>", "repository directory", process.cwd())
  .action(async (opts) => {
    const cwd = resolve(opts.cwd);
    let config = loadLocalConfig(cwd);
    if (opts.profile) config = { ...config, reviews: { ...config.reviews, profile: opts.profile } };
    if (opts.model) config = { ...config, model: opts.model };

    const diff = readDiff(opts, cwd);
    if (!diff.trim()) { console.error("Nothing to review: the diff is empty."); process.exit(0); }
    const fromGit = gitLog(cwd, opts.base);
    const input = { title: opts.title ?? fromGit.title, description: opts.description ?? fromGit.description, diff, config };

    if (opts.dryRun) {
      console.log("=== SYSTEM ===\n" + buildSystemPrompt(config) + "\n\n=== USER ===\n" + buildUserPrompt({ ...input }));
      return;
    }
    const generate = createClaudeGenerate(createDefaultClient(), { model: config.model });
    console.error(`[carrot-review] reviewing with ${config.model} (${config.reviews.profile})…`);
    const result = await reviewChanges(input, { generate });
    console.log(opts.json ? JSON.stringify(result, null, 2) : renderTerminalReport(result));
    process.exit(exitCodeFor(result, opts.failOn as FailOn));
  });

program
  .command("explain")
  .description("Explain a diff as a Change Stack: layers, what to read first, blast radius and an architecture diagram.")
  .option("-b, --base <ref>", "base ref to diff against (merge-base with HEAD)", "main")
  .option("-s, --staged", "explain staged changes")
  .option("-w, --working", "explain all uncommitted changes against HEAD")
  .option("-d, --diff <file>", "read a unified diff from a file ('-' for stdin)")
  .option("-t, --title <text>", "title (defaults to the last commit subject)")
  .option("--description <text>", "description (defaults to commit messages since base)")
  .option("-m, --model <id>", "Claude model id (overrides config)")
  .option("--heuristic", "skip the model even when a credential is available")
  .option("--json", "print the result as JSON")
  .option("--html <file>", "write the interactive Change Stack page to a file")
  .option("-C, --cwd <dir>", "repository directory", process.cwd())
  .action(async (opts) => {
    const cwd = resolve(opts.cwd);
    const config = loadLocalConfig(cwd);
    const diff = readDiff(opts, cwd);
    if (!diff.trim()) { console.error("Nothing to explain: the diff is empty."); process.exit(0); }
    const fromGit = gitLog(cwd, opts.base);
    const useModel = !opts.heuristic && hasAnthropicCredential();
    const model = opts.model ?? config.model;
    console.error(`[carrot-review] explaining with ${useModel ? model : "path heuristics (no Anthropic credential or --heuristic)"}…`);
    const generate = useModel ? createStructuredGenerate(createDefaultClient(), { model }, ChangeStackOutputSchema) : undefined;
    const result = await explainChanges({ title: opts.title ?? fromGit.title, description: opts.description ?? fromGit.description, diff }, { generate });
    if (opts.html) {
      writeFileSync(resolve(cwd, opts.html), renderExplainPage(result, { repo: "local", number: 0 }));
      console.error(`[carrot-review] wrote ${opts.html}`);
    }
    if (opts.json) console.log(JSON.stringify({ stack: result.stack, overview: result.overview, layerStats: result.layerStats, semantic: result.semantic }, null, 2));
    else if (!opts.html) console.log(renderExplainMarkdown(result));
  });

const secure = program.command("secure").description("Security scanning: deep scans of a checkout and PR-style scans of a diff.");
secure
  .command("scan [dir]")
  .description("Map (patterns) → Hunt (model) → Verify (reachability, exploitability, blast radius). Scans a directory, or a diff with --diff.")
  .option("-d, --diff <file>", "scan the added lines of a unified diff instead of a directory ('-' for stdin)")
  .option("-b, --base <ref>", "with --diff-from-git: base ref to diff against", "main")
  .option("--diff-from-git", "scan the diff of the current branch against --base")
  .option("--min-severity <level>", "Critical, High, Medium or Low (overrides config)")
  .option("--heuristic", "patterns and path heuristics only; skip the model even with a credential")
  .option("--repo <owner/name>", "label for the report and the stored scan", "local/checkout")
  .option("--save", "store the scan under .carrot-review/security/ so the server can serve /secure")
  .option("--json", "print JSON")
  .option("--html <file>", "write the posture page to a file")
  .option("--fail-on <level>", "exit 1 when a kept finding is at or above: critical, high, medium, low, none", "none")
  .option("-C, --cwd <dir>", "directory holding .carrot-review.yaml", process.cwd())
  .action(async (dir: string | undefined, opts) => {
    const cwd = resolve(opts.cwd);
    let config = loadLocalConfig(cwd);
    if (opts.minSeverity) config = { ...config, security: { ...config.security, min_severity: opts.minSeverity } };
    const deps = createSecurityDeps({ model: config.model, heuristic: Boolean(opts.heuristic), log: (m) => console.error(`[carrot-review] ${m}`) });
    console.error(`[carrot-review] scanning with ${deps.hunt ? config.model : "patterns and heuristics (no Anthropic credential or --heuristic)"}…`);

    let result;
    let totalFiles: Record<string, number> | undefined;
    if (opts.diff || opts.diffFromGit) {
      const diff = opts.diff ? readDiff({ diff: opts.diff }, cwd) : git(cwd, ["diff", `${opts.base}...HEAD`]);
      result = await scanDiff(diff, { hunt: deps.hunt, verify: deps.verify, minSeverity: config.security.min_severity });
    } else {
      const root = resolve(cwd, dir ?? ".");
      const local = await collectLocalFiles(root, { exclude: config.security.exclude });
      console.error(`[carrot-review] walking ${local.files.length} files (${local.skipped.length} skipped)`);
      result = await runDeepScan(local.files, config, deps);
      totalFiles = local.totalByArea;
    }

    if (opts.save) console.error(`[carrot-review] saved ${await saveScan(cwd, { repo: opts.repo, result, totalFiles })}`);
    if (opts.html) { writeFileSync(resolve(cwd, opts.html), renderPosturePage(result, { repo: opts.repo, totalFiles })); console.error(`[carrot-review] wrote ${opts.html}`); }
    if (opts.json) console.log(JSON.stringify({ repo: opts.repo, result, posture: buildPosture(result, { totalFiles }) }, null, 2));
    else if (!opts.html) console.log(renderScanMarkdown(result, { repo: opts.repo }));

    const failOn = String(opts.failOn).toLowerCase();
    const threshold: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    if (failOn in threshold && result.findings.some((f) => SEVERITY_RANK[f.severity as SecSeverity] <= threshold[failOn]!)) process.exit(1);
  });

program
  .command("triage <repo>")
  .description("Score, rank and route the open pull requests of a repository (owner/name or GitHub URL).")
  .option("-v, --view <id>", "view: all, needs-my-review, authored-by-me, safe-to-merge, or a saved view id", "all")
  .option("--me <login>", "your GitHub login, for the 'needs my review' and 'authored by me' views")
  .option("--ai", "add Claude's value and risk assessment on top of the heuristics")
  .option("--demo", "use built-in demo data instead of GitHub")
  .option("--json", "print JSON instead of the board")
  .option("-C, --cwd <dir>", "directory holding .carrot-review.yaml", process.cwd())
  .action(async (repoArg: string, opts) => {
    const config = loadLocalConfig(resolve(opts.cwd));
    const { owner, repo } = opts.demo ? { owner: "acme", repo: "platform" } : parseRepo(repoArg);
    const token = opts.demo ? undefined : githubToken();
    if (!opts.demo && !token) { console.error("No GitHub token: set GITHUB_TOKEN or sign in with `gh auth login`."); process.exit(2); }
    const load = createTriageLoader({ token, demo: Boolean(opts.demo), config, ai: Boolean(opts.ai), log: (m) => console.error(`[carrot-review] ${m}`) });
    const full = `${owner}/${repo}`;
    const items = await load(full);
    const saved = savedViewsFrom(config);
    const view = resolveView(opts.view, saved);
    const shown = applyView(items, view, opts.me);
    if (opts.json) console.log(JSON.stringify({ repo: full, view: view.id, groups: groupByPriority(shown) }, null, 2));
    else console.log(renderTerminalBoard(full, view.name, shown));
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(`[carrot-review] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
});
