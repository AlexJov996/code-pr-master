import { describe, expect, test } from "vitest";
import { DEFAULT_CONFIG, parseConfig } from "../../src/core/config.js";
import { handleIssueComment, handlePullRequest, helpText, parseCommand, type HandlerDeps } from "../../src/github/handlers.js";

function deps(overrides: Partial<HandlerDeps> = {}) {
  const log: string[] = [];
  const d: HandlerDeps = {
    getOctokit: async () => ({}) as any,
    loadConfig: async () => DEFAULT_CONFIG,
    runReview: async () => { log.push("review"); },
    postComment: async (_o, _ref, body) => { log.push(`comment:${body.slice(0, 20)}`); },
    ...overrides,
  };
  return { d, log };
}

const base = {
  installation: { id: 5 },
  repository: { name: "platform", owner: { login: "acme" } },
  pull_request: { number: 482, draft: false, state: "open", head: { sha: "abc" }, base: { ref: "main" } },
};

describe("handlePullRequest", () => {
  test("reviews on opened, synchronize and ready_for_review", async () => {
    for (const action of ["opened", "synchronize", "ready_for_review", "reopened"]) {
      const { d, log } = deps();
      await handlePullRequest({ ...base, action }, d);
      expect(log, action).toEqual(["review"]);
    }
  });

  test("ignores other actions", async () => {
    const { d, log } = deps();
    await handlePullRequest({ ...base, action: "labeled" }, d);
    expect(log).toEqual([]);
  });

  test("skips drafts unless the config allows them", async () => {
    const draft = { ...base, action: "opened", pull_request: { ...base.pull_request, draft: true } };
    const off = deps();
    await handlePullRequest(draft, off.d);
    expect(off.log).toEqual([]);
    const on = deps({ loadConfig: async () => parseConfig("reviews:\n  auto_review:\n    drafts: true\n") });
    await handlePullRequest(draft, on.d);
    expect(on.log).toEqual(["review"]);
  });

  test("skips when auto review is disabled or the base branch is not listed", async () => {
    const disabled = deps({ loadConfig: async () => parseConfig("reviews:\n  auto_review:\n    enabled: false\n") });
    await handlePullRequest({ ...base, action: "opened" }, disabled.d);
    expect(disabled.log).toEqual([]);
    const branches = deps({ loadConfig: async () => parseConfig("reviews:\n  auto_review:\n    base_branches: [release/*]\n") });
    await handlePullRequest({ ...base, action: "opened" }, branches.d);
    expect(branches.log).toEqual([]);
    const match = deps({ loadConfig: async () => parseConfig("reviews:\n  auto_review:\n    base_branches: [main]\n") });
    await handlePullRequest({ ...base, action: "opened" }, match.d);
    expect(match.log).toEqual(["review"]);
  });
});

describe("parseCommand", () => {
  test("recognises mentions anywhere in the comment, case-insensitively", () => {
    expect(parseCommand("@carrot-review review")).toBe("review");
    expect(parseCommand("please\n@Carrot-Review   HELP ")).toBe("help");
    expect(parseCommand("@carrot-review full review")).toBe("review");
    expect(parseCommand("@carrot-review dance")).toBe("unknown");
    expect(parseCommand("no mention here")).toBeUndefined();
  });
});

describe("handleIssueComment", () => {
  const comment = (body: string, extra: Record<string, unknown> = {}) => ({
    action: "created",
    installation: { id: 5 },
    repository: { name: "platform", owner: { login: "acme" } },
    issue: { number: 482, pull_request: { url: "x" } },
    comment: { body, user: { type: "User", login: "casey" } },
    ...extra,
  });

  test("runs a review on the review command", async () => {
    const { d, log } = deps();
    await handleIssueComment(comment("@carrot-review review"), d);
    expect(log).toEqual(["review"]);
  });

  test("replies with help text on the help command", async () => {
    const { d, log } = deps();
    await handleIssueComment(comment("@carrot-review help"), d);
    expect(log[0]).toMatch(/^comment:/);
    expect(helpText()).toContain("@carrot-review review");
  });

  test("ignores comments from bots, on plain issues, and without a mention", async () => {
    const bot = deps();
    await handleIssueComment(comment("@carrot-review review", { comment: { body: "@carrot-review review", user: { type: "Bot", login: "x[bot]" } } }), bot.d);
    expect(bot.log).toEqual([]);
    const issue = deps();
    await handleIssueComment(comment("@carrot-review review", { issue: { number: 1 } }), issue.d);
    expect(issue.log).toEqual([]);
    const none = deps();
    await handleIssueComment(comment("lgtm"), none.d);
    expect(none.log).toEqual([]);
  });
});

describe("explain command", () => {
  test("parseCommand recognises explain", () => {
    expect(parseCommand("@carrot-review explain")).toBe("explain");
    expect(parseCommand("@carrot-review explain this please")).toBe("explain");
  });

  test("handleIssueComment runs the explain pipeline on the explain command", async () => {
    const log: string[] = [];
    const d: HandlerDeps = {
      getOctokit: async () => ({}) as any,
      loadConfig: async () => DEFAULT_CONFIG,
      runReview: async () => { log.push("review"); },
      runExplain: async () => { log.push("explain"); },
      postComment: async () => { log.push("comment"); },
    };
    await handleIssueComment({
      action: "created", installation: { id: 5 }, repository: { name: "platform", owner: { login: "acme" } },
      issue: { number: 482, pull_request: { url: "x" } }, comment: { body: "@carrot-review explain", user: { type: "User", login: "casey" } },
    }, d);
    expect(log).toEqual(["explain"]);
    expect(helpText()).toContain("@carrot-review explain");
  });
});
