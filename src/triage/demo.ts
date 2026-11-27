import { scorePullRequest, type PullRequestSignals } from "./score.js";
import type { TriageItem } from "./views.js";

const h = (hours: number, now: Date) => new Date(now.getTime() - hours * 3_600_000);

/** Fictional open pull requests for running the board without GitHub access. */
export function demoItems(now = new Date()): TriageItem[] {
  const base = (n: number, o: Partial<PullRequestSignals>): PullRequestSignals => ({
    repo: "acme/platform", number: n, title: "", author: "casey", authorIsBot: false, isDraft: false,
    createdAt: h(6, now), updatedAt: h(2, now), baseRef: "main", additions: 40, deletions: 10, files: ["src/ui/app.tsx"],
    labels: [], requestedReviewers: [], reviews: [], ciStatus: "success", url: `https://github.com/acme/platform/pull/${n}`, ...o,
  });
  const signals: PullRequestSignals[] = [
    base(25493, { title: "fix(auth): rotate exposed production signing key", author: "sentinel-agent[bot]", authorIsBot: true, files: ["services/identity/keys.ts", "services/identity/rotate.ts"], additions: 120, deletions: 60, labels: ["security"], createdAt: h(1, now), updatedAt: h(0.5, now) }),
    base(25095, { title: "feat(mcp): add integrations-authoritative reverse tunnel routing", author: "casey", files: ["packages/core/mcp/tunnel.ts", "packages/core/mcp/router.ts", "services/gateway/routes.ts", "docs/mcp.md"], additions: 640, deletions: 80, requestedReviewers: ["priya"], createdAt: h(20, now), updatedAt: h(3, now) }),
    base(24917, { title: "chore(ci): pin terraform provider and bump runner image", author: "noor", files: ["infra/terraform/providers.tf", ".github/workflows/deploy.yml"], additions: 30, deletions: 12, ciStatus: "pending", createdAt: h(30, now), updatedAt: h(5, now) }),
    base(25473, { title: "fix(reviews): stop reporting a successful reviewer request as a failure", author: "kenji", files: ["src/reviews/request.ts", "src/reviews/request.test.ts"], additions: 48, deletions: 20, linkedIssueSeverity: "Medium", createdAt: h(8, now), updatedAt: h(1, now) }),
    base(25467, { title: "fix(triage): exclude authored PRs from the review queue", author: "layla", files: ["src/triage/queue.ts"], additions: 18, deletions: 6, reviews: [{ author: "casey", state: "APPROVED", submittedAt: h(4, now) }], updatedAt: h(5, now), createdAt: h(10, now) }),
    base(23204, { title: "Autofix path instructions, try 2", author: "mateo", files: ["src/autofix/paths.ts", "src/autofix/paths.test.ts"], additions: 90, deletions: 40, reviews: [{ author: "casey", state: "COMMENTED", submittedAt: h(100, now) }], requestedReviewers: ["casey"], createdAt: h(140, now), updatedAt: h(90, now) }),
    base(22972, { title: "Add metered billing period support and caching", author: "minjun", files: ["services/billing/periods.ts", "services/billing/cache.ts", "services/billing/periods.test.ts"], additions: 410, deletions: 55, reviews: [{ author: "priya", state: "CHANGES_REQUESTED", submittedAt: h(50, now) }], createdAt: h(120, now), updatedAt: h(96, now) }),
    base(1369, { title: "Document repository tabs for security scan results", author: "carrot-review[bot]", authorIsBot: true, files: ["docs/security/tabs.md"], additions: 60, deletions: 0, linkedIssueSeverity: "Low", createdAt: h(40, now), updatedAt: h(40, now) }),
    base(23447, { title: "fix(roles): scope assigned users count to the session org", author: "priya", files: ["services/iam/roles.ts"], additions: 22, deletions: 9, requestedReviewers: ["casey"], reviews: [{ author: "casey", state: "COMMENTED", submittedAt: h(30, now) }], createdAt: h(60, now), updatedAt: h(12, now) }),
    base(23682, { title: "perf(dashboards): prune high-cost analytics scans by tenant", author: "thandi", files: ["services/analytics/scan.ts", "services/analytics/plan.ts"], additions: 210, deletions: 160, ciStatus: "failure", createdAt: h(80, now), updatedAt: h(70, now) }),
    base(126, { title: "feat(theme): tasteful depth, applied across the system", author: "nadia", isDraft: true, files: ["packages/ui/theme.ts", "packages/ui/tokens.ts", "apps/web/styles.css"], additions: 320, deletions: 140, createdAt: h(50, now), updatedAt: h(2, now) }),
    base(548, { title: "docs(ads): separate brand and non-brand campaign handling", author: "sofia", files: ["docs/ads/campaigns.md"], additions: 35, deletions: 12, createdAt: h(70, now), updatedAt: h(70, now) }),
    base(63, { title: "feat(managed-events): own historical event programs", author: "aarav", files: ["services/events/history.ts", "services/events/program.ts", "apps/web/events/page.tsx"], additions: 260, deletions: 30, reviews: [{ author: "noor", state: "COMMENTED", submittedAt: h(48, now) }], updatedAt: h(20, now), createdAt: h(96, now) }),
    base(2704, { title: "docs(blog): explain graph engineering and LLM orchestration", author: "aarav", files: ["apps/web/blog/graph.mdx"], additions: 180, deletions: 0, createdAt: h(200, now), updatedAt: h(200, now) }),
  ];
  const names: Record<string, string> = { casey: "Casey Reed", priya: "Priya Raman", noor: "Noor Rahman", kenji: "Kenji Sato", layla: "Layla Haddad", mateo: "Mateo Silva", minjun: "Min-jun Park", thandi: "Thandi Ndlovu", nadia: "Nadia Petrova", sofia: "Sofia Alvarez", aarav: "Aarav Mehta" };
  const reviewers: Record<string, string[]> = { "services/identity": ["security-lead"], "services/billing": ["priya"], "services/iam": ["security-lead"], infra: ["noor"], "packages/core": ["casey"] };
  return signals
    .map((s) => {
      const assessment = scorePullRequest({ ...s, authorName: names[s.author] }, { now });
      const area = s.files.map((f) => f.split("/").slice(0, 2).join("/")).find((a) => reviewers[a]) ?? s.files[0]!.split("/")[0]!;
      assessment.suggestedReviewers = (reviewers[area] ?? []).filter((r) => r !== s.author && !s.requestedReviewers.includes(r));
      return { signals: { ...s, authorName: names[s.author] }, assessment };
    })
    .sort((a, b) => b.assessment.score - a.assessment.score);
}
