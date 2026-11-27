import type { SecCategory, SecSeverity } from "./schema.js";

export interface Rule {
  id: string;
  category: SecCategory;
  severity: SecSeverity;
  cwe?: string;
  message: string;
  pattern: RegExp;
  /** Only scan files whose path matches. */
  files?: RegExp;
  /** Match against the whole file instead of line by line. */
  multiline?: boolean;
  /** Extra check on the whole file; false suppresses the match (used for taint confirmation). */
  confirm?: (content: string, match: RegExpMatchArray) => boolean;
}

const taintedFrom = (content: string, ident: string) =>
  new RegExp(`(\\b${ident}\\b[^\\n]*=\\s*req\\.|\\{[^}\\n]*\\b${ident}\\b[^}\\n]*\\}\\s*=\\s*req\\.|\\b${ident}\\b\\s*=\\s*(req|request|params|query|body|input|event)\\b)`).test(content);

export const RULES: Rule[] = [
  { id: "hardcoded-aws-key", category: "Secrets", severity: "Critical", cwe: "CWE-798", message: "An AWS access key id is hardcoded in source. Rotate it and load it from the environment.", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: "private-key-material", category: "Secrets", severity: "Critical", cwe: "CWE-321", message: "Private key material is committed to the repository. Revoke the key and move it to a secret store.", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { id: "hardcoded-github-token", category: "Secrets", severity: "Critical", cwe: "CWE-798", message: "A GitHub token is hardcoded in source. Revoke it and read it from the environment.", pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/ },
  { id: "hardcoded-secret-assignment", category: "Secrets", severity: "Medium", cwe: "CWE-798", message: "A password, secret or API key looks hardcoded. Load it from configuration instead.", pattern: /\b(?:password|passwd|secret|api[_-]?key|private[_-]?key|client[_-]?secret)\s*[:=]\s*["'][^"'$]{8,}["']/i },
  { id: "sql-string-interpolation", category: "Data flow", severity: "High", cwe: "CWE-89", message: "SQL is built with template interpolation. Use parameters or an allowlist for identifiers.", pattern: /\b(?:query|raw|execute|exec|prepare)\s*\(\s*`[^`]*\b(?:SELECT|INSERT|UPDATE|DELETE|DROP|WHERE|ORDER\s+BY)\b[^`]*\$\{/i },
  { id: "sql-string-concatenation", category: "Data flow", severity: "High", cwe: "CWE-89", message: "SQL is built by string concatenation. Use parameters instead.", pattern: /\b(?:query|raw|execute|exec|prepare)\s*\(\s*["'][^"']*\b(?:SELECT|INSERT|UPDATE|DELETE|WHERE)\b[^"']*["']\s*\+/i },
  { id: "ssrf-user-url", category: "Server side", severity: "High", cwe: "CWE-918", message: "A user-controlled URL is fetched server-side. Internal endpoints, including cloud metadata, become reachable. Validate against an allowlist of hosts.", pattern: /\b(?:fetch|axios(?:\.(?:get|post|put|delete))?|got|request|http\.get|https\.get|urlopen|requests\.(?:get|post))\s*\(\s*(req\.(?:body|query|params)\b[^,)]*|([A-Za-z_]*[uU][rR][lL]\w*))\s*[,)]/, confirm: (content, m) => (m[2] ? taintedFrom(content, m[2]) : true) },
  { id: "dynamic-eval", category: "Code execution", severity: "High", cwe: "CWE-95", message: "Dynamic code evaluation. If the input can be influenced by a user this is remote code execution.", pattern: /\beval\s*\(|\bnew\s+Function\s*\(/ },
  { id: "shell-command-interpolation", category: "Code execution", severity: "High", cwe: "CWE-78", message: "A shell command is built from interpolated or concatenated strings. Pass arguments as an array instead.", pattern: /\b(?:exec|execSync|spawn|spawnSync|system|popen|os\.system)\s*\(\s*(?:`[^`]*\$\{|["'][^"']*["']\s*\+)/ },
  { id: "shell-true", category: "Code execution", severity: "Medium", cwe: "CWE-78", message: "subprocess runs with shell=True. Pass an argument list and drop shell=True.", pattern: /\bshell\s*=\s*True\b/ },
  { id: "unsafe-deserialization", category: "Code execution", severity: "High", cwe: "CWE-502", message: "Untrusted data is deserialized with a format that can execute code. Use JSON or a safe loader.", pattern: /\b(?:pickle|cPickle)\.loads?\s*\(|\bunserialize\s*\(|\bObjectInputStream\b|\bMarshal\.load\b|\byaml\.load\s*\([^)]*\)(?!\s*,?\s*Loader)/ },
  { id: "tls-verification-disabled", category: "Configuration", severity: "High", cwe: "CWE-295", message: "TLS certificate verification is disabled, which allows man-in-the-middle attacks.", pattern: /rejectUnauthorized\s*:\s*false|\bverify\s*=\s*False\b|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0|InsecureSkipVerify\s*:\s*true/ },
  { id: "weak-hash", category: "Cryptography", severity: "Medium", cwe: "CWE-328", message: "MD5 or SHA-1 is used. Use SHA-256 or a password hash such as argon2 or bcrypt.", pattern: /createHash\s*\(\s*["'](?:md5|sha1)["']\s*\)|hashlib\.(?:md5|sha1)\s*\(|MessageDigest\.getInstance\s*\(\s*"(?:MD5|SHA-?1)"/i },
  { id: "insecure-random-for-secret", category: "Cryptography", severity: "Medium", cwe: "CWE-338", message: "Math.random is used for something secret. Use a cryptographic random source.", pattern: /Math\.random\s*\(\)[^\n]*\b(?:token|secret|password|key|nonce|session)\b/i },
  { id: "html-injection-sink", category: "Data flow", severity: "Medium", cwe: "CWE-79", message: "Raw HTML is written to the DOM. Any user-controlled text here is cross-site scripting.", pattern: /\.innerHTML\s*=|\bdangerouslySetInnerHTML\b|\bdocument\.write\s*\(|\.outerHTML\s*=/ },
  { id: "jwt-none-algorithm", category: "Access control", severity: "High", cwe: "CWE-347", message: "JWT verification accepts the none algorithm, so unsigned tokens pass.", pattern: /algorithms?\s*:\s*\[?\s*["']none["']/i },
  { id: "cors-wildcard-with-credentials", category: "Configuration", severity: "Medium", cwe: "CWE-942", message: "CORS allows every origin together with credentials.", pattern: /Access-Control-Allow-Origin["']?\s*[:,]\s*["']\*["'][\s\S]{0,200}?Access-Control-Allow-Credentials["']?\s*[:,]\s*["']?true/i, multiline: true },
  { id: "prompt-injection-into-tools", category: "LLM security", severity: "Critical", message: "Untrusted text is interpolated into a prompt for a tool-calling model. A crafted input can steer the agent into calling tools on an attacker's behalf. Separate data from instructions and gate tool calls.", pattern: /\b(?:complete|chat|generate|invoke|run|create|responses\.create|messages\.create)\s*\(\s*`[^`]*\$\{[^`]*`[\s\S]{0,300}?\btools\s*:/, multiline: true },
];

const UNSCANNABLE = [
  /(^|\/)(node_modules|dist|build|out|vendor|coverage|\.git|\.next|target)\//,
  /\.min\.(js|css)$/,
  /(^|\/)(pnpm-lock\.yaml|yarn\.lock|package-lock\.json|Cargo\.lock|poetry\.lock|Gemfile\.lock|composer\.lock|go\.sum)$/,
  /\.(md|mdx|rst|txt|adoc|png|jpe?g|gif|svg|ico|woff2?|ttf|otf|eot|pdf|zip|gz|tgz|bz2|7z|mp4|mp3|mov|csv|tsv|map|wasm|jar|class|pyc|so|dylib|dll|exe|bin)$/i,
];

export function isScannable(path: string): boolean {
  return !UNSCANNABLE.some((re) => re.test(path));
}

export interface PatternMatch {
  ruleId: string;
  rule: Rule;
  line: number;
  text: string;
}

const COMMENT = /^\s*(\/\/|#|\*|\/\*|<!--|--\s|;)/;

function lineOfIndex(content: string, index: number): number {
  let n = 1;
  for (let i = 0; i < index && i < content.length; i++) if (content.charCodeAt(i) === 10) n++;
  return n;
}

/** Run every rule over one file. Comment lines are ignored for line rules. */
export function matchPatterns(path: string, content: string): PatternMatch[] {
  if (!isScannable(path)) return [];
  const out: PatternMatch[] = [];
  const lines = content.split("\n");
  for (const rule of RULES) {
    if (rule.files && !rule.files.test(path)) continue;
    if (rule.multiline) {
      const re = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : rule.pattern.flags + "g");
      for (const m of content.matchAll(re)) {
        if (rule.confirm && !rule.confirm(content, m)) continue;
        const line = lineOfIndex(content, m.index ?? 0);
        out.push({ ruleId: rule.id, rule, line, text: (lines[line - 1] ?? "").trim() });
      }
      continue;
    }
    lines.forEach((text, i) => {
      if (COMMENT.test(text)) return;
      const m = text.match(rule.pattern);
      if (!m) return;
      if (rule.confirm && !rule.confirm(content, m)) return;
      out.push({ ruleId: rule.id, rule, line: i + 1, text: text.trim() });
    });
  }
  return out;
}
