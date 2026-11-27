export type FileStatus = "added" | "modified" | "deleted" | "renamed";

export interface DiffLine {
  type: "add" | "del" | "context";
  content: string;
  oldLine?: number;
  newLine?: number;
}

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  oldPath?: string;
  status: FileStatus;
  hunks: Hunk[];
  additions: number;
  deletions: number;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

function stripPrefix(p: string): string {
  return p.replace(/^[ab]\//, "");
}

/** Parse a `git diff` / unified diff into per-file structures with new-side line numbers. */
export function parseUnifiedDiff(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  let current: FileDiff | undefined;
  let hunk: Hunk | undefined;
  let oldLine = 0;
  let newLine = 0;

  for (const raw of text.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;

    const header = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (header) {
      current = {
        path: header[2]!,
        oldPath: header[1]! !== header[2]! ? header[1]! : undefined,
        status: "modified",
        hunks: [],
        additions: 0,
        deletions: 0,
      };
      files.push(current);
      hunk = undefined;
      continue;
    }
    if (!current) continue;

    if (line.startsWith("new file mode")) { current.status = "added"; continue; }
    if (line.startsWith("deleted file mode")) { current.status = "deleted"; continue; }
    if (line.startsWith("rename from ")) { current.oldPath = line.slice("rename from ".length); current.status = "renamed"; continue; }
    if (line.startsWith("rename to ")) { current.path = line.slice("rename to ".length); current.status = "renamed"; continue; }
    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      const p = line.slice(4);
      if (line.startsWith("+++ ") && p !== "/dev/null") current.path = stripPrefix(p);
      if (line.startsWith("--- ") && p === "/dev/null") current.status = "added";
      if (line.startsWith("+++ ") && p === "/dev/null") current.status = "deleted";
      continue;
    }

    const h = line.match(HUNK_RE);
    if (h) {
      hunk = {
        oldStart: Number(h[1]),
        oldLines: h[2] === undefined ? 1 : Number(h[2]),
        newStart: Number(h[3]),
        newLines: h[4] === undefined ? 1 : Number(h[4]),
        header: (h[5] ?? "").trim(),
        lines: [],
      };
      current.hunks.push(hunk);
      oldLine = hunk.oldStart;
      newLine = hunk.newStart;
      continue;
    }
    if (!hunk) continue;

    if (line.startsWith("+")) {
      hunk.lines.push({ type: "add", content: line.slice(1), newLine: newLine++ });
      current.additions++;
    } else if (line.startsWith("-")) {
      hunk.lines.push({ type: "del", content: line.slice(1), oldLine: oldLine++ });
      current.deletions++;
    } else if (line.startsWith(" ") || line === "") {
      hunk.lines.push({ type: "context", content: line.slice(1), oldLine: oldLine++, newLine: newLine++ });
    }
    // "\ No newline at end of file" and anything else is ignored.
  }
  return files;
}

/** New-side line numbers that GitHub accepts as anchors for a review comment on this file. */
export function commentableLines(file: FileDiff): Set<number> {
  const out = new Set<number>();
  for (const h of file.hunks) for (const l of h.lines) if (l.newLine !== undefined) out.add(l.newLine);
  return out;
}

/** Render one file's diff with explicit new-side line numbers so a model can cite them exactly. */
export function renderAnnotatedDiff(file: FileDiff): string {
  const title = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;
  const out: string[] = [`### ${title} (${file.status}, +${file.additions}/-${file.deletions})`];
  for (const h of file.hunks) {
    out.push(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@ ${h.header}`.trimEnd());
    for (const l of h.lines) {
      const num = l.newLine === undefined ? "     " : String(l.newLine).padStart(5);
      const mark = l.type === "add" ? "+" : l.type === "del" ? "-" : " ";
      out.push(`${num} ${mark} | ${l.content}`);
    }
  }
  return out.join("\n");
}
