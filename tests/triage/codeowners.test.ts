import { describe, expect, test } from "vitest";
import { ownersFor, parseCodeowners, suggestReviewers } from "../../src/triage/codeowners.js";

const file = `
# default
*            @acme/maintainers
/docs/       @casey
*.ts         @sam @acme/ts-team
/src/auth/   @security-lead
/src/auth/legacy/*.ts  @oldtimer
`;

describe("parseCodeowners", () => {
  test("keeps rules in order and ignores comments and blank lines", () => {
    const rules = parseCodeowners(file);
    expect(rules).toHaveLength(5);
    expect(rules[0]).toEqual({ pattern: "*", owners: ["@acme/maintainers"] });
    expect(rules[3]).toEqual({ pattern: "/src/auth/", owners: ["@security-lead"] });
  });
});

describe("ownersFor", () => {
  const rules = parseCodeowners(file);
  test("the last matching rule wins", () => {
    expect(ownersFor("src/auth/session.ts", rules)).toEqual(["@security-lead"]);
    expect(ownersFor("src/auth/legacy/old.ts", rules)).toEqual(["@oldtimer"]);
    expect(ownersFor("src/ui/app.ts", rules)).toEqual(["@sam", "@acme/ts-team"]);
    expect(ownersFor("docs/index.md", rules)).toEqual(["@casey"]);
    expect(ownersFor("package.json", rules)).toEqual(["@acme/maintainers"]);
  });

  test("returns no owners when no rule matches", () => {
    expect(ownersFor("anything", [])).toEqual([]);
  });
});

describe("suggestReviewers", () => {
  const rules = parseCodeowners(file);
  test("ranks owners by how many changed files they own and drops the author", () => {
    const files = ["src/auth/a.ts", "src/auth/b.ts", "src/ui/c.ts", "docs/d.md"];
    expect(suggestReviewers(files, rules, { exclude: ["sam"] })).toEqual(["security-lead", "acme/ts-team", "casey"]);
  });

  test("limits the number of suggestions", () => {
    const files = ["src/auth/a.ts", "src/ui/c.ts", "docs/d.md"];
    expect(suggestReviewers(files, rules, { limit: 1 })).toEqual(["security-lead"]);
  });
});
