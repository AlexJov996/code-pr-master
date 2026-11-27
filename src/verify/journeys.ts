import { parse as parseYaml, stringify } from "yaml";
import { z } from "zod";
import { ACTIONS, JourneySchema, StepSchema, type Journey, type Step, type Target } from "./schema.js";

export { StepSchema };

const TARGET_KEYS = ["role", "name", "text", "label", "placeholder", "testId", "selector"] as const;

function stepFromShorthand(raw: unknown): Step {
  if (raw && typeof raw === "object" && "action" in (raw as object)) return StepSchema.parse(raw);
  if (!raw || typeof raw !== "object") throw new Error(`Invalid step: ${JSON.stringify(raw)}`);
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length !== 1) throw new Error(`A step must have exactly one action key, got: ${entries.map((e) => e[0]).join(", ")}`);
  const [action, v] = entries[0]!;
  if (!(ACTIONS as readonly string[]).includes(action)) throw new Error(`Unknown step action "${action}". Known actions: ${ACTIONS.join(", ")}`);
  const step: Step = { action: action as Step["action"] };
  if (action === "goto") { step.url = String(v); return step; }
  if (v === true || v === null || v === undefined) return step;
  if (typeof v !== "object") { step.value = String(v); return step; }
  const o = v as Record<string, unknown>;
  const target: Target = {};
  for (const k of TARGET_KEYS) if (o[k] !== undefined) target[k] = String(o[k]);
  if (Object.keys(target).length) step.target = target;
  if (o.value !== undefined) step.value = String(o.value);
  if (o.url !== undefined) step.url = String(o.url);
  return StepSchema.parse(step);
}

/** Build one journey from a plain object in either the shorthand or the long form. */
export function journeyFromYaml(raw: unknown): Journey {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const steps = Array.isArray(o.steps) ? o.steps.map(stepFromShorthand) : [];
  const result = JourneySchema.safeParse({ ...o, steps });
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join(".") || "<journey>"}: ${i.message}`);
    throw new Error(`Invalid journey${o.id ? ` "${o.id}"` : ""}:\n  ${problems.join("\n  ")}`);
  }
  return result.data;
}

const FileSchema = z.object({ journeys: z.array(z.unknown()).default([]) });

export function parseJourneys(text: string): Journey[] {
  const raw = text.trim() === "" ? {} : (parseYaml(text) ?? {});
  const file = FileSchema.parse(raw);
  return file.journeys.map(journeyFromYaml);
}

function stepToShorthand(s: Step): Record<string, unknown> {
  if (s.action === "goto") return { goto: s.url ?? "/" };
  const o: Record<string, unknown> = {};
  if (s.target) for (const k of TARGET_KEYS) if (s.target[k] !== undefined) o[k] = s.target[k];
  if (s.value !== undefined) o.value = s.value;
  if (s.url !== undefined) o.url = s.url;
  const keys = Object.keys(o);
  if (keys.length === 0) return { [s.action]: true };
  if (keys.length === 1 && keys[0] === "value") return { [s.action]: s.value };
  return { [s.action]: o };
}

export function journeysToYaml(journeys: readonly Journey[]): string {
  return stringify({
    journeys: journeys.map((j) => ({
      id: j.id, title: j.title, goal: j.goal, ...(j.expected ? { expected: j.expected } : {}), ...(j.tags?.length ? { tags: j.tags } : {}),
      ...(j.source !== "saved" ? { source: j.source } : {}), steps: j.steps.map(stepToShorthand),
    })),
  });
}
