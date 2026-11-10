import type {
  EvidenceHit,
  GraphTriplet,
  KnowledgeStore,
  SearchFilters,
  SearchRequest,
  SearchResponse,
} from "@avispl/shared";
import { splitList } from "@avispl/shared";
import { FIXTURE_GRAPH, FIXTURES, type Fixture } from "./fixtures";

/** Hard filters, always applied by the store. The model has no way to set or remove them. */
export const HARD_FILTERS = { status: "published", meeting_room_relevant: true } as const;

const STOPWORDS = new Set(
  "the and for with what our are how which should about have has this that from into your you can does did done like than then them they their there when where who why will would could need needs use using rooms room avi spl avi-spl".split(
    " ",
  ),
);

const tokenize = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9_\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));

const passesHard = (f: Fixture) =>
  f.metadata.status === HARD_FILTERS.status &&
  f.metadata.meeting_room_relevant === HARD_FILTERS.meeting_room_relevant;

const anyIn = (field: string, wanted?: readonly string[]) =>
  !wanted || wanted.length === 0 || wanted.some((w) => splitList(field).includes(w));

const passesModel = (f: Fixture, flt: SearchFilters | undefined) => {
  if (!flt) return true;
  const m = f.metadata;
  if (flt.journey_stage && m.journey_stage !== flt.journey_stage) return false;
  if (flt.content_type && m.content_type !== flt.content_type) return false;
  if (flt.industry && m.industry !== flt.industry) return false;
  if (flt.room_size && !splitList(m.room_sizes).includes(flt.room_size)) return false;
  return anyIn(m.platforms, flt.platforms) && anyIn(m.vendors, flt.vendors) && anyIn(m.topics, flt.topics);
};

const hasModelFilters = (flt: SearchFilters | undefined) =>
  !!flt &&
  Object.values(flt).some((v) => v !== undefined && (!Array.isArray(v) || v.length > 0));

/**
 * Keyword overlap. A single shared word is not enough for a query of 3+ terms (otherwise "design an
 * aquarium for our lobby" matches room designs): it needs 2 distinct matching terms, or an exact term.
 */
const score = (f: Fixture, terms: string[], exact: string[]): number => {
  const m = f.metadata;
  const hay = `${f.title} ${f.text} ${m.section} ${m.topics.replace(/[_,]/g, " ")} ${m.platforms} ${m.room_sizes} ${m.industry.replace(/_/g, " ")}`.toLowerCase();
  const distinct = [...new Set(terms)];
  let matched = 0;
  for (const t of distinct) if (hay.includes(t)) matched += 1;
  let exactHits = 0;
  for (const e of exact) if (hay.includes(e.toLowerCase())) exactHits += 1;
  if (exactHits === 0 && distinct.length >= 3 && matched < 2) return 0;
  return matched + 2 * exactHits;
};

const toHit = (f: Fixture, s: number): Omit<EvidenceHit, "ref"> => {
  const m = f.metadata;
  return {
    chunkId: f.chunkId,
    sourceId: f.sourceId,
    text: f.text,
    title: f.title,
    sourceUrl: m.source_url,
    pageTitle: m.page_title,
    section: m.section,
    pageRange: m.page_range || undefined,
    journeyStage: m.journey_stage,
    contentType: m.content_type,
    lastModified: m.last_modified || undefined,
    edition: m.edition || undefined,
    csOrganization: m.cs_organization || undefined,
    csRoomsCount: m.cs_rooms_count || undefined,
    flags: {
      legacyPlatform: m.legacy_platform,
      metricsAreEstimates: m.metrics_are_estimates,
      requiresDisclosure: m.requires_disclosure,
    },
    score: s,
  };
};

/** Offline, keyless KnowledgeStore over SYNTHETIC fixtures. Proves plumbing and UI only, nothing about relevance. */
export class MockKnowledgeStore implements KnowledgeStore {
  readonly name = "mock";
  constructor(
    private readonly fixtures: Fixture[] = FIXTURES,
    private readonly graph: GraphTriplet[] = FIXTURE_GRAPH,
  ) {}

  async search(req: SearchRequest): Promise<SearchResponse> {
    const t0 = Date.now();
    const terms = tokenize(req.query);
    const exact = req.exactTerms ?? [];
    const max = req.maxResults ?? 8;

    const run = (flt: SearchFilters | undefined) =>
      this.fixtures
        .filter(passesHard)
        .filter((f) => passesModel(f, flt))
        .map((f) => ({ f, s: score(f, terms, exact) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s || a.f.chunkId.localeCompare(b.f.chunkId));

    let relaxed = false;
    let ranked = run(req.filters);
    if (ranked.length === 0 && hasModelFilters(req.filters)) {
      relaxed = true;
      ranked = run(undefined);
    }

    // Per-source cap of 2, then the final limit. Refs assigned AFTER merge + dedupe, per the contract.
    const perSource = new Map<string, number>();
    const kept = ranked.filter(({ f }) => {
      const n = perSource.get(f.sourceId) ?? 0;
      perSource.set(f.sourceId, n + 1);
      return n < 2;
    });
    const hits: EvidenceHit[] = kept
      .slice(0, max)
      .map(({ f, s }, i) => ({ ref: `S${i + 1}`, ...toHit(f, s) }));

    const ids = new Set(hits.map((h) => h.chunkId));
    const graph = this.graph
      .filter((t) => t.chunkIds.some((c) => ids.has(c)))
      .map((t) => ({ ...t, chunkIds: t.chunkIds.filter((c) => ids.has(c)) }));

    return {
      hits,
      graph,
      relaxed,
      appliedFilters: { ...HARD_FILTERS, ...(relaxed ? {} : (req.filters ?? {})) },
      latencyMs: Date.now() - t0,
    };
  }
}
