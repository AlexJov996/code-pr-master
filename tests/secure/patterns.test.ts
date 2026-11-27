import { describe, expect, test } from "vitest";
import { matchPatterns, RULES } from "../../src/secure/patterns.js";

describe("RULES", () => {
  test("every rule has a unique id, a category, a severity and a message", () => {
    const ids = new Set(RULES.map((r) => r.id));
    expect(ids.size).toBe(RULES.length);
    for (const r of RULES) {
      expect(r.id).toMatch(/^[a-z0-9-]+$/);
      expect(["Critical", "High", "Medium", "Low"]).toContain(r.severity);
      expect(r.message.length).toBeGreaterThan(10);
    }
  });
});

describe("matchPatterns", () => {
  const hit = (path: string, content: string) => matchPatterns(path, content).map((m) => [m.ruleId, m.line]);

  test("finds hardcoded cloud keys and private keys", () => {
    expect(hit("config.ts", 'const key = "AKIAIOSFODNN7EXAMPLE";')).toContainEqual(["hardcoded-aws-key", 1]);
    expect(hit("key.pem", "-----BEGIN RSA PRIVATE KEY-----\nabc")).toContainEqual(["private-key-material", 1]);
    expect(hit("app.ts", 'const token = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";')).toContainEqual(["hardcoded-github-token", 1]);
  });

  test("finds SQL built by string concatenation or template interpolation", () => {
    expect(hit("q.ts", "db.raw(`SELECT * FROM repos ORDER BY ${sort}`)")).toContainEqual(["sql-string-interpolation", 1]);
    expect(hit("q.py", 'cursor.execute("SELECT * FROM users WHERE id = " + user_id)')).toContainEqual(["sql-string-concatenation", 1]);
    expect(hit("q.ts", "db.query('SELECT 1 WHERE id = $1', [id])")).toEqual([]);
  });

  test("finds server-side requests driven by user input", () => {
    expect(hit("preview/image.ts", "const img = await fetch(req.body.url);")).toContainEqual(["ssrf-user-url", 1]);
    expect(hit("ok.ts", 'await fetch("https://api.example.com/x")')).toEqual([]);
  });

  test("finds dynamic code execution and shell commands built from strings", () => {
    expect(hit("a.js", "eval(userInput)")).toContainEqual(["dynamic-eval", 1]);
    expect(hit("a.ts", "exec(`ls ${dir}`)")).toContainEqual(["shell-command-interpolation", 1]);
    expect(hit("a.py", "subprocess.run(cmd, shell=True)")).toContainEqual(["shell-true", 1]);
    expect(hit("a.py", "pickle.loads(data)")).toContainEqual(["unsafe-deserialization", 1]);
  });

  test("finds disabled TLS verification, weak hashes and html sinks", () => {
    expect(hit("c.ts", "rejectUnauthorized: false")).toContainEqual(["tls-verification-disabled", 1]);
    expect(hit("c.py", "requests.get(url, verify=False)")).toContainEqual(["tls-verification-disabled", 1]);
    expect(hit("h.ts", 'createHash("md5")')).toContainEqual(["weak-hash", 1]);
    expect(hit("v.tsx", "el.innerHTML = html")).toContainEqual(["html-injection-sink", 1]);
    expect(hit("v.tsx", "dangerouslySetInnerHTML={{ __html: body }}")).toContainEqual(["html-injection-sink", 1]);
  });

  test("finds prompts that interpolate untrusted text into tool-calling LLM calls", () => {
    const code = "const reply = await llm.complete(`You are a support agent.\\nTicket: ${ticket.body}`, { tools: [refundTool] });";
    expect(hit("agents/support-bot.ts", code)).toContainEqual(["prompt-injection-into-tools", 1]);
  });

  test("reports the correct line in multi-line files and ignores comments", () => {
    const code = "// eval(x) in a comment\nconst a = 1;\neval(a);\n";
    expect(hit("m.js", code)).toEqual([["dynamic-eval", 3]]);
  });

  test("skips lock files, minified bundles and binary-ish paths", () => {
    expect(hit("pnpm-lock.yaml", "eval(x)")).toEqual([]);
    expect(hit("dist/app.min.js", "eval(x)")).toEqual([]);
  });
});
