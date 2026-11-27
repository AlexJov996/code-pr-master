import { promises as fs } from "node:fs";
import { matchesGlob, join, relative } from "node:path";
import { isScannable } from "./patterns.js";
import type { ScanFile } from "./scan.js";

const HARD_SKIP = new Set([".git", "node_modules", ".next", ".turbo", ".cache", "dist", "build", "out", "coverage", "vendor", "target", "__pycache__", ".venv", "venv"]);

export interface LocalCollection {
  files: ScanFile[];
  /** Walked but not scannable (docs, binaries, oversized). */
  skipped: string[];
  /** Every file per top-level area, excluded ones included, so the posture map can show what was not walked. */
  totalByArea: Record<string, number>;
}

export interface LocalOptions {
  exclude?: string[];
  maxBytes?: number;
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
  const totalByArea: Record<string, number> = {};

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of entries) {
      const abs = join(dir, ent.name);
      const rel = relative(root, abs).split("\\").join("/");
      if (ent.isDirectory()) {
        if (HARD_SKIP.has(ent.name)) continue;
        await walk(abs);
        continue;
      }
      if (!ent.isFile()) continue;
      const area = rel.includes("/") ? rel.split("/")[0]! : "(root)";
      totalByArea[area] = (totalByArea[area] ?? 0) + 1;
      if (exclude.some((g) => matchesGlob(rel, g))) continue;
      if (!isScannable(rel)) { skipped.push(rel); continue; }
      const stat = await fs.stat(abs);
      if (stat.size > maxBytes) { skipped.push(rel); continue; }
      const buf = await fs.readFile(abs);
      if (looksBinary(buf)) { skipped.push(rel); continue; }
      files.push({ path: rel, content: buf.toString("utf8") });
    }
  }
  await walk(root);
  return { files, skipped, totalByArea };
}
