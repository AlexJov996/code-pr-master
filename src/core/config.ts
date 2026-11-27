import { matchesGlob } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

export const PROFILES = ["chill", "assertive", "quiet"] as const;
export type Profile = (typeof PROFILES)[number];

const PathInstruction = z.object({
  path: z.string().min(1),
  instructions: z.string().min(1),
});

export const ConfigSchema = z.object({
  language: z.string().default("en-US"),
  tone_instructions: z.string().default(""),
  model: z.string().default("claude-opus-5-5"),
  reviews: z
    .object({
      profile: z.enum(PROFILES).default("chill"),
      high_level_summary: z.boolean().default(true),
      path_filters: z.array(z.string()).default([]),
      path_instructions: z.array(PathInstruction).default([]),
      auto_review: z
        .object({
          enabled: z.boolean().default(true),
          drafts: z.boolean().default(false),
          base_branches: z.array(z.string()).default([]),
        })
        .prefault({}),
    })
    .prefault({}),
});

export type Config = z.infer<typeof ConfigSchema>;
export type PathInstructionRule = z.infer<typeof PathInstruction>;

export const CONFIG_FILENAMES = [".carrot-review.yaml", ".carrot-review.yml"] as const;

export const DEFAULT_CONFIG: Config = ConfigSchema.parse({});

/** Parse YAML config text; empty or whitespace-only text yields defaults. Throws a readable error on invalid values. */
export function parseConfig(text: string): Config {
  const raw = text.trim() === "" ? {} : (parseYaml(text) ?? {});
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`);
    throw new Error(`Invalid config:\n  ${problems.join("\n  ")}`);
  }
  return result.data;
}

/**
 * Decide whether a path is in scope. Negated globs (`!pattern`) exclude; if any positive
 * globs exist the path must match one of them; with no filters everything is included.
 */
export function matchesPathFilters(path: string, filters: readonly string[]): boolean {
  const negated = filters.filter((f) => f.startsWith("!")).map((f) => f.slice(1));
  const positive = filters.filter((f) => !f.startsWith("!"));
  if (negated.some((g) => matchesGlob(path, g))) return false;
  if (positive.length === 0) return true;
  return positive.some((g) => matchesGlob(path, g));
}

/** Instructions from every rule whose glob matches the path, in config order. */
export function instructionsForPath(path: string, rules: readonly PathInstructionRule[]): string[] {
  return rules.filter((r) => matchesGlob(path, r.path)).map((r) => r.instructions);
}
