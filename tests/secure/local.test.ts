import { execSync } from "node:child_process";
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

describe("collectLocalFiles never reads secrets or ignored files", () => {
  const dir = mkdtempSync(join(tmpdir(), "carrot-secure-git-"));
  execSync("git init -q", { cwd: dir });
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "secrets"), { recursive: true });
  mkdirSync(join(dir, ".carrot-review/security"), { recursive: true });
  writeFileSync(join(dir, ".gitignore"), "secrets/\n.env\n");
  writeFileSync(join(dir, "src/a.ts"), "eval(x)\n");
  writeFileSync(join(dir, ".env"), "ANTHROPIC_API_KEY=sk-ant-not-a-real-key\n");
  writeFileSync(join(dir, ".env.local"), "X=1\n");
  writeFileSync(join(dir, ".env.example"), "ANTHROPIC_API_KEY=\n");
  writeFileSync(join(dir, "secrets/key.ts"), "eval(x)\n");
  writeFileSync(join(dir, ".carrot-review/security/last.json"), "{}\n");

  test("skips dotenv files, gitignored paths and its own output directory", async () => {
    const r = await collectLocalFiles(dir);
    const paths = r.files.map((f) => f.path);
    expect(paths).toContain("src/a.ts");
    expect(paths).not.toContain(".env");
    expect(paths).not.toContain(".env.local");
    expect(paths).not.toContain("secrets/key.ts");
    expect(paths.some((p) => p.startsWith(".carrot-review/"))).toBe(false);
    expect(r.ignored).toEqual(expect.arrayContaining([".env", ".env.local", "secrets/key.ts"]));
    expect(r.ignored).not.toContain(".env.example");
    expect(JSON.stringify(r)).not.toContain("sk-ant-");
  });
});
