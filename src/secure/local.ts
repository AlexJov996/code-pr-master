import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { matchesGlob, join, relative } from "node:path";
import { isScannable } from "./patterns.js";
import type { ScanFile } from "./scan.js";

const HARD_SKIP = new Set([".git", ".carrot-review", "node_modules", ".next", ".turbo", ".cache", "dist", "build", "out", "coverage", "vendor", "target", "__pycache__", ".venv", "venv"]);

export interface LocalCollection {
  files: ScanFile[];
  /** Walked but not scannable (docs, binaries, oversized). */
  skipped: string[];
  /** Never read: dotenv files and paths the repository's .gitignore excludes. */
  ignored: string[];
  /** Every file per top-level area, excluded ones included, so the posture map can show what was not walked. */
  totalByArea: Record<string, number>;
}

export interface LocalOptions {
  exclude?: string[];
  maxBytes?: number;
}

/** `.env`, `.env.local`, `.env.production`… hold real secrets; `.env.example`-style files hold placeholders and are fine. */
export function isDotenvSecret(name: string): boolean {
  return /^\.env(\..+)?$/.test(name) && !/\.(example|sample|template|dist|defaults?)$/i.test(name);
}

/** Paths git would ignore under `root`, relative to it, or undefined when `root` is not inside a git work tree. */
function gitIgnored(root: string): Set<string> | undefined {
  try {
    const out = execFileSync("git", ["-C", root, "ls-files", "--others", "--ignored", "--exclude-standard", "-z", "--directory"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return new Set(out.split("\0").filter(Boolean).map((p) => p.replace(/\/$/, "")));
  } catch {
    return undefined;
  }
}

function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/** Walk a checkout and read the files a deep scan should look at. */
export async function collectLocalFiles(root: string, opts: LocalOptions = {}): Promise<LocalCollection> {
  const maxBytes = opts.maxBytes ?? 512_000;
  const exclude = opts.exclude ?? [];
  const files: ScanFile[] = [];
  const skipped: string[] = [];
  const ignored: string[] = [];
  const totalByArea: Record<string, number> = {};
  const ignoredByGit = gitIgnored(root);
  const isIgnored = (rel: string): boolean => {
    if (!ignoredByGit) return false;
    if (ignoredByGit.has(rel)) return true;
    for (let i = rel.indexOf("/"); i !== -1; i = rel.indexOf("/", i + 1)) if (ignoredByGit.has(rel.slice(0, i))) return true;
    return false;
  };

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of entries) {
      const abs = join(dir, ent.name);
      const rel = relative(root, abs).split("\\").join("/");
      if (ent.isDirectory()) {
        if (HARD_SKIP.has(ent.name)) continue;
        if (isIgnored(rel)) { await collectIgnored(abs, rel); continue; }
        await walk(abs);
        continue;
      }
      if (!ent.isFile()) continue;
      const area = rel.includes("/") ? rel.split("/")[0]! : "(root)";
      totalByArea[area] = (totalByArea[area] ?? 0) + 1;
      if (isDotenvSecret(ent.name) || isIgnored(rel)) { ignored.push(rel); continue; }
      if (exclude.some((g) => matchesGlob(rel, g))) continue;
      if (!isScannable(rel)) { skipped.push(rel); continue; }
      const stat = await fs.stat(abs);
      if (stat.size > maxBytes) { skipped.push(rel); continue; }
      const buf = await fs.readFile(abs);
      if (looksBinary(buf)) { skipped.push(rel); continue; }
      files.push({ path: rel, content: buf.toString("utf8") });
    }
  }
  async function collectIgnored(dir: string, relDir: string): Promise<void> {
    for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
      const rel = `${relDir}/${ent.name}`;
      if (ent.isDirectory()) await collectIgnored(join(dir, ent.name), rel);
      else if (ent.isFile()) ignored.push(rel);
    }
  }
  await walk(root);
  return { files, skipped, ignored, totalByArea };
}
