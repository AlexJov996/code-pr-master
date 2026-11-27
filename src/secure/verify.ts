import { SEC_SEVERITIES, SEVERITY_RANK, type SecSeverity, type SecurityFinding, type Verification } from "./schema.js";

const UNREACHABLE = /(^|\/)(tests?|__tests__|spec|fixtures?|examples?|samples?|docs?|mocks?|__mocks__|stories|storybook|scripts?|benchmarks?)\/|\.(test|spec|stories)\.\w+$|\.(md|mdx|rst|txt)$|\.(example|sample|template|dist)(\.\w+)?$/i;
const REACHABLE = /(^|\/)(api|routes?|controllers?|handlers?|server|endpoints?|views|pages|app|web|graphql|resolvers?|middleware|workers?|jobs?|cli|bin|functions?|lambda|edge|webhooks?)(\/|\.)/i;

export function heuristicReachability(path: string): Verification["reachability"] {
  if (UNREACHABLE.test(path)) return "Unreachable";
  if (REACHABLE.test(path)) return "Reachable";
  return "Unknown";
}

function shift(severity: SecSeverity, delta: number): SecSeverity {
  const idx = Math.min(SEC_SEVERITIES.length - 1, Math.max(0, SEVERITY_RANK[severity] + delta));
  return SEC_SEVERITIES[idx]!;
}

/**
 * Fold a verification into a finding. Unreachable code caps severity at Low; hard-to-exploit findings
 * drop one level; a high blast radius raises one level. Rejected findings keep their severity for the record.
 */
export function applyVerification(finding: SecurityFinding, v: Verification): SecurityFinding {
  let severity = finding.severity;
  if (v.verdict !== "Rejected") {
    if (v.reachability === "Unreachable") severity = "Low";
    else {
      if (v.exploitability === "Hard") severity = shift(severity, 1);
      if (v.blastRadius === "High") severity = shift(severity, -1);
    }
  }
  return { ...finding, severity, verification: { ...v } };
}

export interface VerifyDeps {
  /** Model-backed verification for one finding; omitted means path heuristics only. */
  verify?: (finding: SecurityFinding) => Promise<Verification>;
  concurrency?: number;
  onError?: (finding: SecurityFinding, err: unknown) => void;
}

export interface VerifyResult {
  kept: SecurityFinding[];
  rejected: SecurityFinding[];
}

export async function verifyFindings(findings: readonly SecurityFinding[], deps: VerifyDeps): Promise<VerifyResult> {
  const results: SecurityFinding[] = new Array(findings.length);
  const limit = Math.max(1, deps.concurrency ?? 4);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, findings.length) }, async () => {
    while (next < findings.length) {
      const i = next++;
      const f = findings[i]!;
      const heuristic: Verification = { reachability: heuristicReachability(f.path), exploitability: "Unknown", blastRadius: "Unknown", verdict: "Needs review", reasoning: "Path heuristics only; not verified against the code." };
      let v = heuristic;
      if (deps.verify) {
        try { v = await deps.verify(f); } catch (err) { deps.onError?.(f, err); }
      }
      results[i] = applyVerification(f, v);
    }
  }));
  return { kept: results.filter((f) => f.verification.verdict !== "Rejected"), rejected: results.filter((f) => f.verification.verdict === "Rejected") };
}
