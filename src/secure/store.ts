import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { ScanResult } from "./schema.js";

export interface StoredScan {
  repo: string;
  result: ScanResult;
  totalFiles?: Record<string, number>;
}

const dirFor = (cwd: string) => join(cwd, ".carrot-review", "security");
const fileFor = (cwd: string, repo: string) => join(dirFor(cwd), `${repo.replace("/", "__")}.json`);

/** Persist a deep scan so the server can serve the posture page without re-scanning. */
export async function saveScan(cwd: string, scan: StoredScan): Promise<string> {
  await fs.mkdir(dirFor(cwd), { recursive: true });
  const path = fileFor(cwd, scan.repo);
  await fs.writeFile(path, JSON.stringify(scan, null, 2));
  return path;
}

export async function loadStoredScan(cwd: string, repo: string): Promise<StoredScan | undefined> {
  try {
    return JSON.parse(await fs.readFile(fileFor(cwd, repo), "utf8")) as StoredScan;
  } catch {
    return undefined;
  }
}
