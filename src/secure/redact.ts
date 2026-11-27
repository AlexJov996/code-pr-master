/**
 * Mask secret values so they never land in findings, comments, stored scans or pages.
 * The recognisable prefix stays so a reader knows what kind of secret it was.
 */
const RULES: Array<[RegExp, string]> = [
  [/\bsk-ant-[A-Za-z0-9_-]{8,}/g, "sk-ant-…"],
  [/\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{16,}/g, "sk-…"],
  [/\b(gh[pousr])_[A-Za-z0-9]{10,}/g, "$1_…"],
  [/\bgithub_pat_[A-Za-z0-9_]{10,}/g, "github_pat_…"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "AKIA…"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, "xox…"],
  [/\bAIza[0-9A-Za-z_-]{20,}/g, "AIza…"],
  [/(-----BEGIN [A-Z ]*PRIVATE KEY-----)[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----)/g, "$1\n…\n$2"],
  [/\b(api[_-]?key|secret|token|password|passwd|private[_-]?key|client[_-]?secret)(\s*[:=]\s*["']?)[^\s"']{8,}/gi, "$1$2…"],
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const [re, rep] of RULES) out = out.replace(re, rep);
  return out;
}
