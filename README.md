# carrot-review

Three of CodeRabbit's products, rebuilt: **Review**, a GitHub App that reviews every pull request with a walkthrough, a changes table, pre-merge checks and line-anchored findings (plus a CLI that runs the same engine on a local diff); **Triage**, a board that scores, ranks and routes a repository's open pull requests; and **Explain** (their "Understand" pillar), a Change Stack walkthrough that splits a large diff into ordered layers with what to read first, blast radius context and an architecture diagram.

The output format follows what CodeRabbit posts on public pull requests: a sticky summary comment (walkthrough, grouped changes, effort estimate, pre-merge checks) and inline comments of the form `category | severity | effort`, a one-line title, an explanation, a proposed fix diff, and a self-contained prompt for coding agents.

## What is in the box

| Surface | Entry point | What it does |
|---|---|---|
| Review engine | `src/core/` | Parses unified diffs with new-side line numbers, builds the prompts, calls Claude with a structured output schema, validates and snaps findings onto real diff lines, applies the review profile, renders Markdown. |
| GitHub App | `src/server/`, `src/github/` | Signature-verified webhook endpoint. Reviews on `opened`, `synchronize`, `reopened`, `ready_for_review`; answers `@carrot-review review` and `@carrot-review help` in PR comments. Posts one sticky summary comment and one review with inline comments. |
| CLI | `src/cli/`, `bin/carrot-review.js` | `review` (default) reviews a branch, staged or working-tree diff (or a diff file) and prints the report; `--fail-on` makes it a CI gate. `triage owner/name` prints the board. |
| Explain | `src/understand/` | Splits a diff into ordered layers with dependencies and risks, summarizes the regions worth reading with a complexity rating, detects symbol-level changes, computes blast radius, and draws a Mermaid architecture diagram. Uses Claude when a credential exists and a path-based heuristic otherwise. Posted with `@carrot-review explain`, served at `/explain`, printed by `carrot-review explain`. |
| Triage | `src/triage/` | Collects open pull requests from GitHub, scores each for priority (P0 to P3), risk, review depth, blast radius, complexity and effort, decides the next action, explains why in one line, and suggests reviewers from CODEOWNERS. Served as a board at `/triage` and as JSON at `/api/triage.json`. |

## Quick start (CLI)

```bash
pnpm install
export ANTHROPIC_API_KEY=sk-ant-...
pnpm review --base main
```

Other forms:

```bash
pnpm review --staged                 # what you are about to commit
pnpm review --working                # every uncommitted change
pnpm review --diff change.patch      # a saved diff ('-' for stdin)
pnpm review --profile assertive --fail-on major
pnpm review --dry-run                # print the prompts, do not call the model
pnpm review --json                   # machine-readable result
```

## Running the GitHub App

1. Create a GitHub App with these permissions: **Pull requests: read & write**, **Contents: read**, **Issues: read & write**, **Metadata: read**. Subscribe to the **Pull request** and **Issue comment** events. Set the webhook URL to `https://<your-host>/api/webhooks/github`.
2. Copy `.env.example` to `.env` and fill in the app id, webhook secret, private key and your Anthropic key.
3. Start the server:

```bash
pnpm dev
```

The server acknowledges each webhook immediately and runs the review in the background, since GitHub times webhooks out after ten seconds.

## Triage board

```bash
export GITHUB_TOKEN=$(gh auth token)       # or any token that can read the repository
pnpm review triage acme/platform --me casey
pnpm review triage acme/platform --view needs-my-review
pnpm review triage acme/platform --ai        # adds Claude's value/risk judgment per PR
pnpm review triage x --demo                  # built-in fictional data, no GitHub needed
```

To serve the board, start the server with `GITHUB_TOKEN` set (and optionally `CARROT_ME=<your login>`), then open `http://localhost:3000/triage?repo=owner/name`. `CARROT_TRIAGE_DEMO=1` serves fictional data instead.

Built-in views: All reviews, Needs my review, Authored by me, Safe to merge. Saved views come from the config (below): filter by risk, tags, labels, paths, base branch globs, next action, or bot authorship.

How scoring works, in short:

- **Risk** is High for auth, secrets, crypto, SSO, billing, IAM and infrastructure paths, Medium for large or widely spread changes or titles that mention secrets, Low otherwise. Docs-only changes are always Low.
- **Review depth** follows risk: Deep, Standard, Quick, or Review later for drafts.
- **Next action** comes from state: drafts, failing checks and requested changes need the author; approved, green and low-risk is safe to merge; a requested reviewer with no review yet is waiting on that reviewer; everything else needs a human.
- **Priority** is P0 for hotfix labels, critical linked issues, and high-risk changes to security-critical code or by agents; P1 for other high-risk work; P3 for docs; P2 otherwise. Drafts cap at P2 and author-owned work at P1, since a reviewer cannot act on those.
- **Routing** ranks CODEOWNERS owners by how many changed files they own, excluding the author and anyone already requested.

## Explain (Change Stack)

```bash
pnpm review explain --base main                       # Markdown walkthrough of the branch
pnpm review explain --diff change.patch --html stack.html   # interactive page with layers, diffs and summaries
pnpm review explain --staged --json
pnpm review explain --heuristic                       # skip the model even with a credential
```

In a pull request, comment `@carrot-review explain` and the bot posts (and later updates) one comment with the walkthrough. With the server running, `http://localhost:3000/explain?repo=owner/name&pr=482` shows the Change Stack page: layers on the left, per-file diffs with a "Mark viewed" toggle in the middle, region summaries filterable by complexity on the right, and the diagram. `/api/explain.md` and `/api/explain.json` serve the same data. `CARROT_DEMO=1` serves a fictional pull request.

What it produces:

- **Layers**: 2 to 6 ordered steps (data model, service and API, UI, tests, docs), each with its files, a description, the layers it depends on, and risks. Without a model the layers come from path conventions.
- **What to read first**: region summaries with new-side line ranges and a High, Medium or Low complexity rating. Without a model, one per added or changed function, class or model, rated by length.
- **Semantic diff**: added, removed or modified functions, classes, interfaces, types, Prisma models and imports, detected from the diff for TypeScript, JavaScript, Python, Go, Prisma and a few others.
- **Blast radius**: files, areas and security-sensitive paths for the whole change and per layer, with an attention list for reviewers.
- **Architecture**: a Mermaid flowchart from the model's component edges, or from relative imports between changed files.

## Configuration

Put a `.carrot-review.yaml` at the repository root. The GitHub App reads it from the pull request head; the CLI reads it from the working directory. Every key is optional.

```yaml
language: en-US
tone_instructions: "Be direct. Skip praise."
model: claude-opus-5-5
reviews:
  profile: chill            # chill | assertive | quiet
  path_filters:
    - "!**/*.lock"
    - "src/**"
  path_instructions:
    - path: "src/api/**"
      instructions: "Every handler must validate its input."
  auto_review:
    enabled: true
    drafts: false
    base_branches: ["main", "release/*"]
triage:
  ai_assessment: false
  saved_views:
    - id: security-watch
      name: Security watch
      filter: { risk: [High] }
    - id: release-train
      name: Release train
      filter: { base_branches: ["release/*"] }
```

Profiles map to severity thresholds: `quiet` posts only Critical and Major findings, `chill` drops Nitpicks, `assertive` posts everything.

## Development

```bash
pnpm test        # vitest, 144 tests, no network
pnpm typecheck   # tsc --noEmit
```

The model call is injected (`Generate` in `src/core/review.ts`), so the whole pipeline is tested without an API key. `src/core/claude.ts` is the only file that talks to Anthropic.

## Not built yet

Review, Triage and Explain are in. CodeRabbit's other products (Secure, Verify, the IDE extension, GitLab support) are not.
