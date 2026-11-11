import { disclosureEnabled } from "../config/disclosure";
import { z } from "zod";
import type { EvidenceHit, GraphTriplet, KnowledgeStore, SearchFilters } from "@avispl/shared";
import {
  CONTENT_TYPES,
  INDUSTRIES,
  JOURNEY_STAGES,
  PLATFORMS,
  ROOM_SIZES,
  TOPICS,
  VENDORS,
} from "@avispl/shared";
import type { RefRegistry } from "./refs";

/**
 * Pure tool logic (no AI SDK), so it can be unit-tested against the mock store.
 * The model-facing input schemas contain ONLY model-choosable filters. Hard filters
 * (status=published, meeting_room_relevant=true) are not in the schema, so zod strips them if sent,
 * and the store adds them itself.
 */
export const searchJourneyInput = z.object({
  query: z.string().min(2).max(400).describe("Natural-language search query. Rephrase between calls."),
  journey_stage: z.enum(JOURNEY_STAGES).optional().describe("Restrict to one journey stage."),
  content_type: z.enum(CONTENT_TYPES).optional(),
  platforms: z.array(z.enum(PLATFORMS)).max(4).optional(),
  vendors: z.array(z.enum(VENDORS)).max(9).optional(),
  topics: z.array(z.enum(TOPICS)).max(6).optional(),
  room_size: z.enum(ROOM_SIZES).optional(),
  industry: z.enum(INDUSTRIES).optional(),
  exact_terms: z
    .array(z.string().min(2).max(60))
    .max(5)
    .optional()
    .describe("Literal tokens such as product names, for a keyword match."),
});
export type SearchJourneyInput = z.infer<typeof searchJourneyInput>;

export const findCaseStudiesInput = z.object({
  industry: z.enum(INDUSTRIES).optional(),
  platform: z.enum(PLATFORMS).optional(),
  topic: z.enum(TOPICS).optional(),
});
export type FindCaseStudiesInput = z.infer<typeof findCaseStudiesInput>;

export interface ToolHit extends EvidenceHit {
  /** Plain-language cautions the model must respect when citing this hit. */
  cautions: string[];
}

export interface SearchToolOutput {
  kind: "search" | "case_studies";
  query: string;
  backend: string;
  hits: ToolHit[];
  graph: GraphTriplet[];
  relaxed: boolean;
  appliedFilters: Record<string, unknown>;
  note?: string;
  /** True when the store threw (e.g. HydraDB unreachable or misconfigured). hits is then empty. */
  unavailable?: boolean;
}

/** What the customer reads when no search worked. Deliberately short: no explanation of our systems. */
export const UNAVAILABLE_REPLY = "Sorry, I can't answer that right now. Please share your email and our team will reach out to you shortly.";
/** What they read once they have sent the email (the chat route logs it for the team: see contact-request.ts). */
export const UNAVAILABLE_THANKS = "Thank you. Our team will reach out to you shortly.";
const UNAVAILABLE_NOTE =
  "This search failed. Never mention the failure, a knowledge base or published content being unreachable. " +
  "If other searches in this conversation returned hits, answer from those hits only. " +
  `If no search returned hits, reply with exactly this and nothing else (translated into the customer's language): "${UNAVAILABLE_REPLY}" ` +
  `If the customer has already sent an email address in this conversation, reply instead with exactly: "${UNAVAILABLE_THANKS}" ` +
  "Never repeat the email address. Do not answer from memory and ask nothing else.";

/** Converts a store failure into a tool result the model must not answer around. */
export function unavailableOutput(kind: SearchToolOutput["kind"], query: string, backend: string): SearchToolOutput {
  return {
    kind,
    query,
    backend,
    hits: [],
    graph: [],
    relaxed: false,
    appliedFilters: {},
    unavailable: true,
    note: UNAVAILABLE_NOTE,
  };
}

export const cautionsFor = (h: EvidenceHit): string[] => {
  const c: string[] = [];
  if (h.flags.legacyPlatform) c.push("older platform generation: say so if you cite it as proof");
  if (h.flags.metricsAreEstimates) c.push("figures are estimates: present any numbers as estimates");
  if (h.flags.requiresDisclosure && disclosureEnabled()) c.push("licensing-sensitive: call getLicensingDisclosure");
  if (h.edition === "2021") c.push("2021 edition: possibly superseded by newer material");
  if (h.journeyStage === "proof") c.push("proof: cite only capabilities this text says were deployed");
  return c;
};

const RELAXED_NOTE =
  "No results matched the requested filters, so the search was retried with only the mandatory filters. Treat these hits as broader, possibly less specific evidence.";

const finish = (
  kind: SearchToolOutput["kind"],
  query: string,
  backend: string,
  hits: EvidenceHit[],
  graph: GraphTriplet[],
  relaxed: boolean,
  appliedFilters: Record<string, unknown>,
  registry: RefRegistry,
): SearchToolOutput => {
  const numbered = registry.assign(hits).map((h) => ({ ...h, cautions: cautionsFor(h) }));
  const ids = new Set(numbered.map((h) => h.chunkId));
  const keptGraph = graph
    .map((t) => ({ ...t, chunkIds: t.chunkIds.filter((c) => ids.has(c)) }))
    .filter((t) => t.chunkIds.length > 0);
  const notes: string[] = [];
  if (relaxed) notes.push(RELAXED_NOTE);
  if (numbered.length === 0)
    notes.push("Nothing relevant was found. Do not answer from memory; say so and offer the closest in-scope topic.");
  return {
    kind,
    query,
    backend,
    hits: numbered,
    graph: keptGraph,
    relaxed,
    appliedFilters,
    note: notes.length ? notes.join(" ") : undefined,
  };
};

export async function runSearchJourney(
  store: KnowledgeStore,
  registry: RefRegistry,
  rawInput: unknown,
): Promise<SearchToolOutput> {
  const input = searchJourneyInput.parse(rawInput); // strips anything not in the schema
  const filters: SearchFilters = {
    journey_stage: input.journey_stage,
    content_type: input.content_type,
    platforms: input.platforms,
    vendors: input.vendors,
    topics: input.topics,
    room_size: input.room_size,
    industry: input.industry,
  };
  for (const k of Object.keys(filters) as (keyof SearchFilters)[]) if (filters[k] === undefined) delete filters[k];
  const res = await store.search({ query: input.query, filters, exactTerms: input.exact_terms, maxResults: 8 });
  return finish("search", input.query, store.name, res.hits, res.graph, res.relaxed, res.appliedFilters, registry);
}

/** Case studies first by room count (desc), with older-platform proof always last. */
export const sortCaseStudies = <T extends EvidenceHit>(hits: T[]): T[] =>
  [...hits].sort(
    (a, b) =>
      Number(a.flags.legacyPlatform) - Number(b.flags.legacyPlatform) ||
      (b.csRoomsCount ?? 0) - (a.csRoomsCount ?? 0) ||
      b.score - a.score,
  );

export async function runFindCaseStudies(
  store: KnowledgeStore,
  registry: RefRegistry,
  rawInput: unknown,
): Promise<SearchToolOutput> {
  const input = findCaseStudiesInput.parse(rawInput);
  const query = ["case study customer deployment", input.industry?.replace(/_/g, " "), input.platform, input.topic?.replace(/_/g, " ")]
    .filter(Boolean)
    .join(" ");
  const filters: SearchFilters = { journey_stage: "proof", content_type: "case_study" };
  if (input.industry) filters.industry = input.industry;
  if (input.platform) filters.platforms = [input.platform];
  if (input.topic) filters.topics = [input.topic];
  const res = await store.search({ query, filters, maxResults: 8 });
  // The store's relax step drops ALL model filters, including stage/type. This tool's restriction is
  // not negotiable, so we re-apply it in code whatever the store returned.
  const onlyProof = res.hits.filter((h) => h.journeyStage === "proof" && h.contentType === "case_study");
  return finish(
    "case_studies",
    query,
    store.name,
    sortCaseStudies(onlyProof),
    res.graph,
    res.relaxed,
    { ...res.appliedFilters, journey_stage: "proof", content_type: "case_study" },
    registry,
  );
}
