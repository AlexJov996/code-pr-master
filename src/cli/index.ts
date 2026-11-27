import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import { createClaudeGenerate, createDefaultClient } from "../core/claude.js";
import { CONFIG_FILENAMES, DEFAULT_CONFIG, parseConfig, PROFILES, type Config } from "../core/config.js";
import { renderTerminalReport } from "../core/format.js";
import { buildSystemPrompt, buildUserPrompt } from "../core/prompt.js";
import { reviewChanges } from "../core/review.js";
import { diffCommandFor, exitCodeFor, type FailOn } from "./options.js";

function loadLocalConfig(cwd: string): Config {
  for (const name of CONFIG_FILENAMES) {
    const p = resolve(cwd, name);
    if (existsSync(p)) return parseConfig(readFileSync(p, "utf8"));
  }
  return DEFAULT_CONFIG;
}

function readDiff(opts: { diff?: string; base?: string; staged?: boolean; working?: boolean }, cwd: string): string {
  if (opts.diff) return opts.diff === "-" ? readFileSync(0, "utf8") : readFileSync(resolve(cwd, opts.diff), "utf8");
  const [cmd, ...args] = diffCommandFor(opts);
  return execFileSync(cmd!, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function gitLog(cwd: string, base: string): { title: string; description: string } {
  try {
    const subject = execFileSync("git", ["log", "-1", "--format=%s"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const bodies = execFileSync("git", ["log", "--format=%s%n%b", `${base}..HEAD`], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return { title: subject, description: bodies };
  } catch {
    return { title: "", description: "" };
  }
}

const program = new Command()
  .name("carrot-review")
  .description("Review a diff with Claude, the way a CodeRabbit-style bot would, and print the report.")
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

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(`[carrot-review] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
});
