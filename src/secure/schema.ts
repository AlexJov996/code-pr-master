import { z } from "zod";

export const SEC_SEVERITIES = ["Critical", "High", "Medium", "Low"] as const;
export type SecSeverity = (typeof SEC_SEVERITIES)[number];

export const SEC_CATEGORIES = [
  "Access control",
  "LLM security",
  "Business logic",
  "Data flow",
  "Server side",
  "Concurrency",
  "Secrets",
  "Cryptography",
  "Configuration",
  "Code execution",
] as const;
export type SecCategory = (typeof SEC_CATEGORIES)[number];

export const REACHABILITY = ["Reachable", "Unreachable", "Unknown"] as const;
export const EXPLOITABILITY = ["Easy", "Moderate", "Hard", "Not exploitable", "Unknown"] as const;
export const BLAST = ["Low", "Medium", "High", "Unknown"] as const;
export const VERDICT = ["Confirmed", "Rejected", "Needs review"] as const;

export const VerificationSchema = z.object({
  reachability: z.enum(REACHABILITY).describe("Can an attacker reach this code path at all? Unreachable for tests, dead code, or admin-only paths behind strong auth."),
  exploitability: z.enum(EXPLOITABILITY).describe("How hard is it to exploit in practice, given validation, allowlists and surrounding checks."),
  blastRadius: z.enum(BLAST).describe("What a successful exploit touches: one record, one user, every tenant, infrastructure."),
  verdict: z.enum(VERDICT).describe("Confirmed when reachable and exploitable; Rejected for false positives; Needs review when evidence is insufficient."),
  reasoning: z.string().describe("Two or three sentences citing the code that supports the verdict."),
});
export type Verification = z.infer<typeof VerificationSchema>;

export const HuntFindingSchema = z.object({
  category: z.enum(SEC_CATEGORIES),
  title: z.string().min(1).describe("One sentence naming the flaw, ending with a period."),
  path: z.string().min(1).describe("Exact path as given."),
  line: z.number().int().positive().describe("Line of the sink or the decision point."),
  end_line: z.number().int().positive().optional(),
  severity: z.enum(SEC_SEVERITIES),
  cwe: z.string().optional().describe("CWE identifier such as CWE-639 when one fits."),
  description: z.string().min(1).describe("What an attacker does, step by step, and what they get. Three to five sentences."),
  attack_path: z.array(z.string()).describe("Ordered hops from the untrusted source to the sink, each a short code reference."),
  fix_hint: z.string().describe("The change that closes the hole, in one or two sentences. Empty if unsure."),
});

export const HuntOutputSchema = z.object({ findings: z.array(HuntFindingSchema) });
export type HuntOutput = z.infer<typeof HuntOutputSchema>;
export type HuntFinding = z.infer<typeof HuntFindingSchema>;

export const FixOutputSchema = z.object({
  description: z.string().min(1).describe("What the fix changes and why it closes the vulnerability."),
  patched_content: z.string().describe("The complete new content of the file, with the fix applied and nothing else changed."),
});
export type FixOutput = z.infer<typeof FixOutputSchema>;

export interface SecurityFinding {
  id: string;
  ruleId?: string;
  category: SecCategory;
  cwe?: string;
  title: string;
  path: string;
  line: number;
  endLine?: number;
  severity: SecSeverity;
  description: string;
  attackPath: string[];
  fixHint?: string;
  source: "pattern" | "model";
  verification: Verification;
  fix?: { description: string; diff: string; branch?: string; pullRequestUrl?: string };
}

export const SEVERITY_RANK: Record<SecSeverity, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };

/** Result of a scan: findings, what verification rejected, and coverage. */
export interface ScanResult {
  findings: SecurityFinding[];
  rejected: SecurityFinding[];
  walked: string[];
  skipped: string[];
  scannedAt: string;
  mode: "files" | "diff";
}
export type ScanResultLike = ScanResult;
