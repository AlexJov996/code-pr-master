import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { collectLocalFiles } from "../../src/secure/local.js";

describe("collectLocalFiles", () => {
  const dir = mkdtempSync(join(tmpdir(), "carrot-secure-"));
  mkdirSync(join(dir, "src/api"), { recursive: true });
  mkdirSync(join(dir, "node_modules/x"), { recursive: true });
  mkdirSync(join(dir, "legacy"), { recursive: true });
  mkdirSync(join(dir, ".git"), { recursive: true });
  writeFileSync(join(dir, "src/api/a.ts"), "eval(x)\n");
  writeFileSync(join(dir, "src/big.ts"), "x".repeat(600_000));
  writeFileSync(join(dir, "node_modules/x/index.js"), "eval(x)\n");
  writeFileSync(join(dir, "legacy/old.ts"), "eval(x)\n");
  writeFileSync(join(dir, ".git/HEAD"), "ref\n");
  writeFileSync(join(dir, "README.md"), "# hi\n");
  writeFileSync(join(dir, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]));

  test("walks source files, skips excluded globs, binaries, dot-git, and oversized files", async () => {
    const r = await collectLocalFiles(dir, { exclude: ["legacy/**", "**/node_modules/**"] });
    expect(r.files.map((f) => f.path).sort()).toEqual(["src/api/a.ts"]);
    expect(r.files[0]!.content).toBe("eval(x)\n");
    expect(r.skipped).toEqual(expect.arrayContaining(["src/big.ts", "README.md", "logo.png"]));
    expect(r.skipped).not.toContain("legacy/old.ts");
    expect(r.totalByArea).toEqual({ src: 2, legacy: 1, "(root)": 2 });
  });
});
