import type { GraphTriplet, JourneyStage } from "@avispl/shared";
import type { DisclosureToolResult } from "./disclosure";
import type { SearchToolOutput, ToolHit } from "./tool-logic";
import { citedRefs } from "./citations";
import { stripThink } from "./think";

/** Client-safe: derives everything the UI shows for one assistant message from its parts. */
export interface MessageEvidence {
  text: string;
  searches: number;
  pendingTools: number;
  hits: Map<string, ToolHit>; // by ref
  graph: GraphTriplet[];
  relaxed: boolean;
  unavailable: boolean;
  disclosure?: DisclosureToolResult;
  cited: string[];
  dominantStage?: JourneyStage;
  backend?: string;
}

type AnyPart = { type: string; state?: string; text?: string; output?: unknown };

export function tripletKey(t: GraphTriplet): string {
  return `${t.source.name}|${t.relation}|${t.target.name}`;
}

export function mergeGraphs(graphs: GraphTriplet[][]): GraphTriplet[] {
  const byKey = new Map<string, GraphTriplet>();
  for (const g of graphs)
    for (const t of g) {
      const k = tripletKey(t);
      const prev = byKey.get(k);
      if (!prev) byKey.set(k, { ...t, chunkIds: [...t.chunkIds] });
      else {
        prev.chunkIds = [...new Set([...prev.chunkIds, ...t.chunkIds])];
        prev.context ??= t.context;
      }
    }
  return [...byKey.values()];
}

export function extractEvidence(parts: readonly unknown[]): MessageEvidence {
  let text = "";
  let searches = 0;
  let pendingTools = 0;
  let relaxed = false;
  let unavailable = false;
  let disclosure: DisclosureToolResult | undefined;
  let backend: string | undefined;
  const hits = new Map<string, ToolHit>();
  const graphs: GraphTriplet[][] = [];

  for (const raw of parts) {
    const p = raw as AnyPart;
    if (p.type === "text" && typeof p.text === "string") {
      const visible = stripThink(p.text); // belt and braces: never show model reasoning tags
      if (!visible.trim()) continue;
      text += (text && !text.endsWith("\n") ? "\n\n" : "") + visible;
      continue;
    }
    if (p.type === "tool-searchJourney" || p.type === "tool-findCaseStudies") {
      searches++;
      if (p.state === "output-error") {
        unavailable = true;
        continue;
      }
      if (p.state !== "output-available") {
        pendingTools++;
        continue;
      }
      const out = p.output as SearchToolOutput;
      backend = out.backend;
      relaxed ||= out.relaxed;
      unavailable ||= !!out.unavailable;
      for (const h of out.hits) hits.set(h.ref, h);
      graphs.push(out.graph);
    }
    if (p.type === "tool-getLicensingDisclosure") {
      if (p.state === "output-available") disclosure = p.output as DisclosureToolResult;
      else if (p.state !== "output-error") pendingTools++;
    }
  }

  const cited = citedRefs(text);
  const stageCount = new Map<JourneyStage, number>();
  for (const r of cited) {
    const h = hits.get(r);
    if (h) stageCount.set(h.journeyStage, (stageCount.get(h.journeyStage) ?? 0) + 1);
  }
  const dominantStage = [...stageCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  return {
    text,
    searches,
    pendingTools,
    hits,
    graph: mergeGraphs(graphs),
    relaxed,
    unavailable,
    disclosure,
    cited,
    dominantStage,
    backend,
  };
}
