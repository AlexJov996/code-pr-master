# carrot-review

An AI pull request reviewer modeled on CodeRabbit's **Review** product: a GitHub App that reviews every pull request with a walkthrough, a changes table, pre-merge checks and line-anchored findings, plus a CLI that runs the same engine on a local diff.

The output format follows what CodeRabbit posts on public pull requests: a sticky summary comment (walkthrough, grouped changes, effort estimate, pre-merge checks) and inline comments of the form `category | severity | effort`, a one-line title, an explanation, a proposed fix diff, and a self-contained prompt for coding agents.

## What is in the box

| Surface | Entry point | What it does |
|---|---|---|
| Review engine | `src/core/` | Parses unified diffs with new-side line numbers, builds the prompts, calls Claude with a structured output schema, validates and snaps findings onto real diff lines, applies the review profile, renders Markdown. |
| GitHub App | `src/server/`, `src/github/` | Signature-verified webhook endpoint. Reviews on `opened`, `synchronize`, `reopened`, `ready_for_review`; answers `@carrot-review review` and `@carrot-review help` in PR comments. Posts one sticky summary comment and one review with inline comments. |
| CLI | `src/cli/`, `bin/carrot-review.js` | Reviews a branch, staged or working-tree diff (or a diff file) and prints the report. `--fail-on` makes it usable as a CI gate. |

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
```

Profiles map to severity thresholds: `quiet` posts only Critical and Major findings, `chill` drops Nitpicks, `assertive` posts everything.

## Development

```bash
pnpm test        # vitest, 60 tests, no network
pnpm typecheck   # tsc --noEmit
```

The model call is injected (`Generate` in `src/core/review.ts`), so the whole pipeline is tested without an API key. `src/core/claude.ts` is the only file that talks to Anthropic.

## Not built yet

This is the Review product only. CodeRabbit's other products (Triage, Understand, Secure, Verify, IDE extension, GitLab support) are out of scope for this first cut.
