import { describe, expect, test } from "vitest";
import { createClaudeGenerate } from "../../src/core/claude.js";

describe("createClaudeGenerate", () => {
  test("sends system, user message and a structured output format, and returns the parsed output", async () => {
    const seen: any[] = [];
    const client = {
      messages: {
        parse: async (params: any) => {
          seen.push(params);
          return { stop_reason: "end_turn", parsed_output: { walkthrough: "w", changes: [], effort: 1, findings: [] } };
        },
      },
    };
    const generate = createClaudeGenerate(client as any, { model: "claude-opus-5-5" });
    const out = await generate("SYS", "USER");
    expect(out.walkthrough).toBe("w");
    expect(seen[0].model).toBe("claude-opus-5-5");
    expect(seen[0].system).toBe("SYS");
    expect(seen[0].messages).toEqual([{ role: "user", content: "USER" }]);
    expect(seen[0].output_config.format.type).toBe("json_schema");
    expect(seen[0].output_config.effort).toBe("high");
  });

  test("throws a clear error when the model refuses", async () => {
    const client = { messages: { parse: async () => ({ stop_reason: "refusal", parsed_output: null, stop_details: { category: "cyber" } }) } };
    const generate = createClaudeGenerate(client as any, { model: "claude-opus-5-5" });
    await expect(generate("S", "U")).rejects.toThrow(/refus/i);
  });

  test("throws when the output could not be parsed", async () => {
    const client = { messages: { parse: async () => ({ stop_reason: "max_tokens", parsed_output: null }) } };
    const generate = createClaudeGenerate(client as any, { model: "claude-opus-5-5" });
    await expect(generate("S", "U")).rejects.toThrow(/max_tokens/);
  });
});
