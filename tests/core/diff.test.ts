import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { commentableLines, parseUnifiedDiff, renderAnnotatedDiff } from "../../src/core/diff.js";

const sample = readFileSync(new URL("../fixtures/sample.diff", import.meta.url), "utf8");

describe("parseUnifiedDiff", () => {
  test("splits a multi-file diff into one entry per file with status", () => {
    const files = parseUnifiedDiff(sample);
    expect(files.map((f) => [f.path, f.status])).toEqual([
      ["src/cache.ts", "modified"],
      ["README.md", "added"],
      ["old.txt", "deleted"],
      ["b.ts", "renamed"],
    ]);
    expect(files[3]!.oldPath).toBe("a.ts");
  });

  test("counts additions and deletions per file", () => {
    const [cache, readme, old] = parseUnifiedDiff(sample);
    expect(cache!.additions).toBe(4);
    expect(cache!.deletions).toBe(1);
    expect(readme!.additions).toBe(2);
    expect(old!.deletions).toBe(1);
  });

  test("assigns new-side line numbers to added and context lines", () => {
    const [cache] = parseUnifiedDiff(sample);
    const hunk = cache!.hunks[0]!;
    expect(hunk.newStart).toBe(10);
    const added = hunk.lines.filter((l) => l.type === "add").map((l) => [l.newLine, l.content]);
    expect(added).toEqual([
      [11, "  const result = await db.project.update(input);"],
      [12, "  await redis.del(`project:${input.id}`);"],
      [13, "  return result;"],
    ]);
    const deleted = hunk.lines.find((l) => l.type === "del")!;
    expect(deleted.oldLine).toBe(11);
    expect(deleted.newLine).toBeUndefined();
  });
});

describe("commentableLines", () => {
  test("returns every new-side line that appears in a hunk", () => {
    const [cache] = parseUnifiedDiff(sample);
    const lines = commentableLines(cache!);
    expect([...lines]).toEqual([10, 11, 12, 13, 14, 15, 16, 32, 33, 34]);
  });

  test("is empty for a deleted file", () => {
    const old = parseUnifiedDiff(sample)[2]!;
    expect(commentableLines(old).size).toBe(0);
  });
});

describe("renderAnnotatedDiff", () => {
  test("prefixes each line with its new-side number and a change marker", () => {
    const [cache] = parseUnifiedDiff(sample);
    const text = renderAnnotatedDiff(cache!);
    expect(text).toContain("### src/cache.ts (modified, +4/-1)");
    expect(text).toContain("   10   |   const db = getDb();");
    expect(text).toContain("      - |   await db.project.update(input);");
    expect(text).toContain("   11 + |   const result = await db.project.update(input);");
  });
});
