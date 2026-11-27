import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { scanDiff, scanFiles, type ScanDeps } from "../../src/secure/scan.js";
import type { HuntOutput } from "../../src/secure/schema.js";

const files = [
  { path: "src/api/invoices.ts", content: "router.get('/invoices/:id', async (req, res) => {\n  const invoice = await db.invoices.findById(req.params.id);\n  return res.json(invoice);\n});\n" },
  { path: "src/preview/image.ts", content: "const { url } = req.body;\nconst img = await fetch(url);\nres.type('png').send(await img.buffer());\n" },
  { path: "src/search/query.ts", content: "const sort = sanitizeHtml(req.query.sort);\nconst rows = await db.raw(`SELECT * FROM repos ORDER BY ${sort}`);\n" },
  { path: "tests/query.test.ts", content: "eval('1+1')\n" },
  { path: "README.md", content: "eval(x)\n" },
];

const hunt: HuntOutput = {
  findings: [
    { category: "Access control", title: "No ownership check on invoice lookup.", path: "src/api/invoices.ts", line: 2, severity: "High", cwe: "CWE-639", description: "Any signed-in user can read every invoice by iterating IDs.", attack_path: ["GET /invoices/:id", "db.invoices.findById(req.params.id)", "res.json(invoice)"], fix_hint: "Scope the query to the session user's organisation." },
    { category: "Data flow", title: "ORDER BY is built from HTML-escaped input.", path: "src/search/query.ts", line: 2, severity: "Critical", cwe: "CWE-89", description: "sanitizeHtml does not protect SQL.", attack_path: ["req.query.sort", "sanitizeHtml", "db.raw(`... ORDER BY ${sort}`)"], fix_hint: "Allowlist sort columns." },
    { category: "Data flow", title: "Ghost finding.", path: "src/nope.ts", line: 1, severity: "Low", description: "x", attack_path: [], fix_hint: "" },
  ],
};

describe("scanFiles (Map + Hunt)", () => {
  test("without a model, the pattern layer alone finds the SSRF and the SQL interpolation", async () => {
    const r = await scanFiles(files, {});
    const ids = r.findings.map((f) => `${f.ruleId}@${f.path}:${f.line}`);
    expect(ids).toContain("ssrf-user-url@src/preview/image.ts:2");
    expect(ids).toContain("sql-string-interpolation@src/search/query.ts:2");
    expect(r.findings.every((f) => f.source === "pattern")).toBe(true);
    expect(r.walked).toEqual(["src/api/invoices.ts", "src/preview/image.ts", "src/search/query.ts", "tests/query.test.ts"]);
    expect(r.skipped).toEqual(["README.md"]);
  });

  test("the test-file eval is capped to Low by reachability", async () => {
    const r = await scanFiles(files, {});
    const f = r.findings.find((x) => x.path === "tests/query.test.ts")!;
    expect(f.severity).toBe("Low");
    expect(f.verification.reachability).toBe("Unreachable");
  });

  test("with a model, hunt findings are merged, deduplicated against patterns, and anchored to real files", async () => {
    const seen: string[] = [];
    const deps: ScanDeps = { hunt: async (_sys, user) => { seen.push(user); return hunt; } };
    const r = await scanFiles(files, deps);
    expect(seen[0]).toContain("src/api/invoices.ts");
    expect(seen[0]).toContain("router.get('/invoices/:id'");
    const titles = r.findings.map((f) => f.title);
    expect(titles).toContain("No ownership check on invoice lookup.");
    expect(titles).not.toContain("Ghost finding.");
    const sql = r.findings.filter((f) => f.path === "src/search/query.ts" && f.line === 2);
    expect(sql).toHaveLength(1);
    expect(sql[0]!.source).toBe("model");
    expect(sql[0]!.attackPath).toHaveLength(3);
  });

  test("orders findings by severity then path", async () => {
    const r = await scanFiles(files, { hunt: async () => hunt });
    expect(r.findings[0]!.severity).toBe("Critical");
  });

  test("respects a minimum severity", async () => {
    const r = await scanFiles(files, { hunt: async () => hunt, minSeverity: "High" });
    expect(r.findings.every((f) => f.severity === "Critical" || f.severity === "High")).toBe(true);
  });
});

describe("scanDiff (PR scan)", () => {
  const diff = readFileSync(new URL("../fixtures/invitations.diff", import.meta.url), "utf8");

  test("scans only the new-side content of changed files and keeps line numbers", async () => {
    const withSsrf = diff + "diff --git a/src/preview.ts b/src/preview.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/preview.ts\n@@ -0,0 +1,3 @@\n+const { url } = req.body;\n+const img = await fetch(url);\n+res.send(img);\n";
    const r = await scanDiff(withSsrf, {});
    const f = r.findings.find((x) => x.ruleId === "ssrf-user-url")!;
    expect(f.path).toBe("src/preview.ts");
    expect(f.line).toBe(2);
    expect(r.walked).toContain("src/server/invitations/invitationService.ts");
  });

  test("reports nothing for a clean diff", async () => {
    const r = await scanDiff(diff, {});
    expect(r.findings).toEqual([]);
  });
});
