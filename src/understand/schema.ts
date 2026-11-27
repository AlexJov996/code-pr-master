import { z } from "zod";

export const COMPLEXITY = ["Low", "Medium", "High"] as const;
export type Complexity = (typeof COMPLEXITY)[number];

export const LayerOutputSchema = z.object({
  title: z.string().min(1).describe("Imperative, specific title for one logical step of the change, e.g. 'Add the invitation data model'."),
  description: z.string().min(1).describe("One or two sentences on what this layer does and why it exists."),
  files: z.array(z.string()).describe("Paths from the diff that belong to this layer. Every path belongs to exactly one layer."),
  depends_on: z.array(z.string()).describe("Titles of earlier layers this one builds on."),
  risks: z.array(z.string()).describe("Short statements of concrete risks in this layer, or empty."),
});

export const RegionSummaryOutputSchema = z.object({
  path: z.string(),
  start_line: z.number().int().positive().describe("First new-side line of the region."),
  end_line: z.number().int().positive().describe("Last new-side line of the region."),
  symbol: z.string().optional().describe("Function, class or block name when there is one."),
  complexity: z.enum(COMPLEXITY).describe("How hard the region is to understand: High for branching logic, state or security; Low for plumbing."),
  summary: z.string().min(1).describe("One sentence, at most 30 words, on what the region does."),
});

export const ArchitectureEdgeSchema = z.object({
  from: z.string().min(1).describe("Component, module or layer name."),
  to: z.string().min(1),
  label: z.string().optional().describe("Verb for the relationship: calls, reads, sends, renders."),
});

export const ChangeStackOutputSchema = z.object({
  title: z.string().min(1).describe("Short title for the whole change."),
  summary: z.string().min(1).describe("Two or three sentences: what the change does end to end."),
  layers: z.array(LayerOutputSchema).min(1),
  summaries: z.array(RegionSummaryOutputSchema).describe("Summaries of the regions a reviewer must understand, most important first."),
  architecture: z.array(ArchitectureEdgeSchema).describe("Edges between the components the change touches, enough to draw a small diagram."),
});

export type LayerOutput = z.infer<typeof LayerOutputSchema>;
export type ChangeStackOutput = z.infer<typeof ChangeStackOutputSchema>;
export type ArchitectureEdge = z.infer<typeof ArchitectureEdgeSchema>;

export interface Layer {
  title: string;
  description: string;
  files: string[];
  /** Indexes into the ordered layer list. */
  dependsOn: number[];
  risks: string[];
}

export interface RegionSummary {
  path: string;
  startLine: number;
  endLine: number;
  lines: number;
  symbol?: string;
  complexity: Complexity;
  summary: string;
}

export interface ChangeStack {
  title: string;
  summary: string;
  layers: Layer[];
  summaries: RegionSummary[];
  architecture: ArchitectureEdge[];
  source: "model" | "heuristic";
}
