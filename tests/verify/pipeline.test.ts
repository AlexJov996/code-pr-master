import { describe, expect, test } from "vitest";
import { loadSavedJourneys } from "../../src/verify/pipeline.js";

const ref = { owner: "acme", repo: "platform", number: 1 };
const file = (yaml: string) => ({ repos: { getContent: async () => ({ data: { type: "file", encoding: "base64", content: Buffer.from(yaml).toString("base64") } }) } }) as any;

describe("loadSavedJourneys", () => {
  test("a missing file means no saved journeys", async () => {
    const octokit = { repos: { getContent: async () => { throw Object.assign(new Error("Not Found"), { status: 404 }); } } } as any;
    await expect(loadSavedJourneys(octokit, ref, ".carrot-review/journeys.yaml", "abc")).resolves.toEqual([]);
  });

  test("a broken file is an error that names the file, not silently zero journeys", async () => {
    await expect(loadSavedJourneys(file("journeys:\n  - id: x\n    title: x\n    goal: x\n    steps:\n      - fly: /\n"), ref, ".carrot-review/journeys.yaml", "abc")).rejects.toThrow(/journeys\.yaml.*fly/s);
  });

  test("a GitHub error other than 404 is surfaced", async () => {
    const octokit = { repos: { getContent: async () => { throw Object.assign(new Error("boom"), { status: 500 }); } } } as any;
    await expect(loadSavedJourneys(octokit, ref, ".carrot-review/journeys.yaml", "abc")).rejects.toThrow(/boom/);
  });
});
