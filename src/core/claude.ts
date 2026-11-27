import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Generate } from "./review.js";
import { ReviewOutputSchema } from "./schema.js";

export interface ClaudeOptions {
  model: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens?: number;
}

/** The subset of the Anthropic client the generator needs; lets tests pass a stub. */
export type ParseClient = { messages: { parse: Anthropic["messages"]["parse"] } };

export function createClaudeGenerate(client: ParseClient, opts: ClaudeOptions): Generate {
  return async (system, user) => {
    const response = await client.messages.parse({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 16000,
      system,
      messages: [{ role: "user", content: user }],
      output_config: { format: zodOutputFormat(ReviewOutputSchema), effort: opts.effort ?? "high" },
    });
    if (response.stop_reason === "refusal") {
      const category = response.stop_details?.type === "refusal" ? response.stop_details.category : undefined;
      throw new Error(`The model refused to review this change${category ? ` (${category})` : ""}.`);
    }
    if (!response.parsed_output) {
      throw new Error(`The model returned no parsable review (stop_reason=${response.stop_reason}).`);
    }
    return ReviewOutputSchema.parse(response.parsed_output);
  };
}

export function createDefaultClient(): Anthropic {
  return new Anthropic();
}
