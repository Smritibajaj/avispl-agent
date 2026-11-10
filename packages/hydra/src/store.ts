import {
  CONTENT_TYPES,
  JOURNEY_STAGES,
  type ContentType,
  type EvidenceHit,
  type GraphTriplet,
  type JourneyStage,
  type KnowledgeStore,
  type SearchRequest,
  type SearchResponse,
} from "@avispl/shared";
import type { HydraDB } from "@hydradb/sdk";
import { HydraApi, type QueryOutcome, type QueryResult } from "./client";
import { resolveConfig } from "./config";
import { HydraError, HydraValidationError } from "./errors";
import { buildModelFilters, hardOnly, withHardFilters, type MetadataFilters } from "./filters";
import { fromWireMetadata } from "./schema";

export interface HydraStoreOptions {
  /** Default https://api.hydradb.com. Point at the local mock (http://localhost:4010) for offline tests. */
  baseUrl?: string;
  apiKey?: string;
  database?: string;
  collection?: string;
  /** Per-query deadline (ms). Default 5000. */
  timeoutMs?: number;
  /** Env to read when a field above is not given. Default process.env. */
  env?: Record<string, string | undefined>;
  /** Receives non-fatal problems (missing chunk metadata, dropped hits, failed keyword query). Never secrets. */
  onDiagnostic?: (d: StoreDiagnostic) => void;
}

export interface StoreDiagnostic {
  kind:
    | "missing_chunk_metadata" // a citation field was absent from chunk.metadata
    | "dropped_hit" // a chunk could not be cited (no valid URL) or contradicted the hard filters
    | "dropped_filter_value" // model sent a value outside the vocabulary
    | "text_query_failed"; // the parallel exactTerms keyword query failed; hybrid results still returned
  detail: string;
  chunkId?: string;
}

/** Query defaults (DECISIONS.md section 1 + hydra brief). */
export const MAIN_QUERY = {
  type: "knowledge",
  queryBy: "hybrid",
  mode: "thinking",
  maxResults: 20,
  alpha: 0.8,
  recencyBias: 0.1,
  graphContext: true,
  queryForcefulRelations: true,
} as const;

export const PER_SOURCE_CAP = 3;
export const DEFAULT_MAX_RESULTS = 8;
const MAX_TRIPLETS = 60;
const RRF_K = 60;

type Chunk = HydraDB.SearchV2Chunk & Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : v === "true" ? true : v === "false" ? false : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

const isCitableUrl = (u: string | undefined): u is string => {
  if (!u || u.includes("…") || u.includes("...")) return false;
  try {
    const p = new URL(u);
    return p.protocol === "https:" || p.protocol === "http:";
  } catch {
    return false;
  }
};

/** Undocumented but possible: `data.sources[]` (DECISIONS.md section 1 lists it; the v2 query docs do not). */
function sourcesById(data: QueryResult): Map<string, { title?: string; url?: string }> {
  const m = new Map<string, { title?: string; url?: string }>();
  const raw = (data as Record<string, unknown>).sources;
  if (Array.isArray(raw)) {
    for (const s of raw as Record<string, unknown>[]) {
      const id = str(s?.id);
      if (id) m.set(id, { title: str(s.title), url: str(s.url) });
    }
  }
  return m;
}

/** Reciprocal-rank fusion: main hybrid order first, keyword hits can climb; dedupe by chunk id. */
export function mergeChunks(main: Chunk[], text: Chunk[]): Chunk[] {
  const score = new Map<string, number>();
  const byId = new Map<string, Chunk>();
  const order: string[] = [];
  const add = (list: Chunk[], weight: number) =>
    list.forEach((c, i) => {
      const id = c.chunkUuid;
      if (!id) return;
      if (!byId.has(id)) {
        byId.set(id, c);
        order.push(id);
      } else if ((c.relevancyScore ?? 0) > (byId.get(id)!.relevancyScore ?? 0)) {
        byId.set(id, { ...byId.get(id)!, relevancyScore: c.relevancyScore });
      }
      score.set(id, (score.get(id) ?? 0) + weight / (RRF_K + i + 1));
    });
  add(main, 1);
  add(text, 1);
  return order
    .map((id, idx) => ({ id, idx, s: score.get(id) ?? 0 }))
    .sort((a, b) => b.s - a.s || a.idx - b.idx)
    .map((x) => byId.get(x.id)!);
}

/** Literal tokens from the model: strings only, trimmed, deduped, at most 10 x 100 chars. */
export const cleanExactTerms = (terms: unknown): string[] =>
  Array.isArray(terms)
    ? [...new Set(terms.filter((t): t is string => typeof t === "string").map((t) => t.trim().slice(0, 100)).filter(Boolean))].slice(0, 10)
    : [];

const camelToSnake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

export interface SearchPlan {
  modelFilters: MetadataFilters;
  droppedFilterValues: string[];
  /** Wire (snake_case) bodies the store sends for the first attempt (relax retry uses hard filters only). */
  requests: Record<string, unknown>[];
}

/** What `search()` would send, without sending. Used by `query:cli --dry-run` and tests. */
export function planSearch(req: SearchRequest, target: { database: string; collection: string }): SearchPlan {
  const { model, dropped } = buildModelFilters(req.filters);
  const filters = withHardFilters(model);
  const exact = cleanExactTerms(req.exactTerms);
  const wire = (o: Record<string, unknown>) =>
    Object.fromEntries(Object.entries({ database: target.database, collection: target.collection, ...o, responseFormat: "structured" }).map(([k, v]) => [camelToSnake(k), v]));
  const requests = [wire({ ...MAIN_QUERY, query: req.query, metadataFilters: filters })];
  if (exact.length)
    requests.push(wire({ type: "knowledge", queryBy: "text", query: exact.join(" "), maxResults: MAIN_QUERY.maxResults, graphContext: false, metadataFilters: filters }));
  return { modelFilters: model, droppedFilterValues: dropped, requests };
}

export function createHydraKnowledgeStore(opts: HydraStoreOptions = {}): KnowledgeStore {
  let api: HydraApi | undefined;
  const timeoutMs = opts.timeoutMs ?? 5000;
  const diag = (d: StoreDiagnostic) => opts.onDiagnostic?.(d);

  // Lazy: importing/constructing the store must not throw at build time when env is absent.
  const getApi = () =>
    (api ??= new HydraApi(
      resolveConfig(
        { apiKey: opts.apiKey, baseUrl: opts.baseUrl, database: opts.database, collection: opts.collection },
        opts.env,
      ),
      { maxRetries: 0, timeoutInSeconds: timeoutMs / 1000 },
    ));

  async function runQueries(query: string, filters: MetadataFilters, exactTerms: string[]) {
    const a = getApi();
    const mainP = a.query({ ...MAIN_QUERY, query, metadataFilters: filters }, { timeoutMs, maxRetries: 0 });
    const textP: Promise<QueryOutcome | null> = exactTerms.length
      ? a.query(
          { type: "knowledge", queryBy: "text", query: exactTerms.join(" "), maxResults: MAIN_QUERY.maxResults, graphContext: false, metadataFilters: filters },
          { timeoutMs, maxRetries: 0 },
        )
      : Promise.resolve(null);
    const [main, text] = await Promise.allSettled([mainP, textP]);
    if (main.status === "rejected") throw main.reason instanceof HydraError ? main.reason : new HydraError("network", String(main.reason));
    let textOut: QueryOutcome | null = null;
    if (text.status === "rejected") {
      diag({ kind: "text_query_failed", detail: text.reason instanceof Error ? text.reason.message : String(text.reason) });
    } else textOut = text.value;
    const mainChunks = (main.value.data.chunks ?? []) as Chunk[];
    const textChunks = (textOut?.data.chunks ?? []) as Chunk[];
    return { main: main.value, text: textOut, merged: mergeChunks(mainChunks, textChunks) };
  }

  function toHit(c: Chunk, sources: Map<string, { title?: string; url?: string }>, appliedModel: MetadataFilters): Omit<EvidenceHit, "ref"> | null {
    const chunkId = c.chunkUuid ?? "";
    const m = fromWireMetadata((c.metadata ?? {}) as Record<string, unknown>);
    const am = (c.additionalMetadata ?? {}) as Record<string, unknown>;
    const hydraSourceId = c.id ?? "";
    const missing: string[] = [];
    const need = (k: string) => {
      if (m[k] === undefined || m[k] === null) missing.push(k);
      return m[k];
    };

    // Defense in depth: the server applies the hard filters; drop anything that explicitly contradicts them.
    const status = need("status");
    const relevant = need("meeting_room_relevant");
    if ((status !== undefined && status !== "published") || (relevant !== undefined && bool(relevant) === false)) {
      diag({ kind: "dropped_hit", chunkId, detail: `contradicts hard filters (status=${String(status)}, meeting_room_relevant=${String(relevant)})` });
      return null;
    }

    const src = sources.get(hydraSourceId);
    let sourceUrl = str(need("source_url"));
    if (!sourceUrl && src?.url) sourceUrl = src.url; // fallback: data.sources (undocumented)
    if (!isCitableUrl(sourceUrl)) {
      diag({ kind: "dropped_hit", chunkId, detail: `no citable URL (metadata.page_url/source_url=${String(m.source_url)})` });
      return null;
    }

    let journeyStage = need("journey_stage") as JourneyStage | undefined;
    if (!JOURNEY_STAGES.includes(journeyStage as JourneyStage)) {
      const f = appliedModel.journey_stage?.equals;
      journeyStage = JOURNEY_STAGES.includes(f as JourneyStage) ? (f as JourneyStage) : undefined;
    }
    let contentType = need("content_type") as ContentType | undefined;
    if (!CONTENT_TYPES.includes(contentType as ContentType)) {
      const f = appliedModel.content_type?.equals;
      contentType = CONTENT_TYPES.includes(f as ContentType) ? (f as ContentType) : undefined;
    }
    if (!journeyStage || !contentType) {
      diag({ kind: "dropped_hit", chunkId, detail: "journey_stage/content_type missing from chunk metadata" });
      return null;
    }

    const pageTitle = str(need("page_title")) ?? src?.title ?? str(c.sourceTitle) ?? "";
    const section = str(need("section")) ?? "";
    for (const k of ["requires_disclosure", "legacy_platform", "metrics_are_estimates"]) need(k);
    if (missing.length) diag({ kind: "missing_chunk_metadata", chunkId, detail: missing.join(",") });

    const csRooms = num(m.cs_rooms_count);
    return {
      chunkId,
      sourceId: str(am.sourceId) ?? hydraSourceId,
      text: c.chunkContent ?? "",
      title: str(c.sourceTitle) ?? pageTitle,
      sourceUrl,
      pageTitle,
      section,
      ...(str(m.page_range) ? { pageRange: str(m.page_range) } : {}),
      journeyStage,
      contentType,
      ...(str(m.last_modified) ? { lastModified: str(m.last_modified) } : {}),
      ...(str(m.edition) ? { edition: str(m.edition) } : {}),
      ...(str(m.cs_organization) ? { csOrganization: str(m.cs_organization) } : {}),
      ...(csRooms && csRooms > 0 ? { csRoomsCount: csRooms } : {}),
      flags: {
        legacyPlatform: bool(m.legacy_platform) ?? false,
        metricsAreEstimates: bool(m.metrics_are_estimates) ?? false,
        requiresDisclosure: bool(m.requires_disclosure) ?? false,
      },
      score: c.relevancyScore ?? 0,
    };
  }

  function toGraph(data: QueryResult, hitIds: Set<string>): GraphTriplet[] {
    const paths = data.graphContext?.queryPaths ?? [];
    const byKey = new Map<string, GraphTriplet>();
    for (const p of paths) {
      const pathChunks = p.sourceChunkIds ?? [];
      for (const t of p.triplets ?? []) {
        const s = t.source;
        const tg = t.target;
        const rel = t.relation;
        if (!s?.name || !tg?.name || !rel?.canonicalPredicate) continue;
        const chunkIds = [...new Set([...pathChunks, ...(rel.chunkId ? [rel.chunkId] : [])])].filter((id) => hitIds.has(id));
        const rawOrigin = (t as Record<string, unknown>).origin ?? (rel as Record<string, unknown>).origin;
        const origin = rawOrigin === "extracted" || rawOrigin === "byog" || rawOrigin === "declared" ? rawOrigin : undefined;
        const key = `${s.name}|${rel.canonicalPredicate}|${tg.name}`.toLowerCase();
        const prev = byKey.get(key);
        if (prev) {
          prev.chunkIds = [...new Set([...prev.chunkIds, ...chunkIds])];
          if ((p.relevancyScore ?? 0) > (prev.score ?? 0)) prev.score = p.relevancyScore;
          if (!prev.context && rel.context) prev.context = rel.context;
          continue;
        }
        byKey.set(key, {
          source: { name: s.name, type: s.type ?? "" },
          relation: rel.canonicalPredicate,
          target: { name: tg.name, type: tg.type ?? "" },
          ...(rel.context ? { context: rel.context } : {}),
          chunkIds,
          ...(origin ? { origin } : {}),
          ...(typeof p.relevancyScore === "number" ? { score: p.relevancyScore } : {}),
        });
      }
    }
    return [...byKey.values()].slice(0, MAX_TRIPLETS);
  }

  function toLinked(data: QueryResult, hitIds: Set<string>): NonNullable<SearchResponse["linked"]> {
    const out: NonNullable<SearchResponse["linked"]> = [];
    const ac = data.additionalContext ?? {};
    for (const [key, c] of Object.entries(ac)) {
      const id = c.chunkUuid ?? key;
      if (hitIds.has(id)) continue;
      const m = fromWireMetadata((c.metadata ?? {}) as Record<string, unknown>);
      const am = (c.additionalMetadata ?? {}) as Record<string, unknown>;
      if ((m.status !== undefined && m.status !== "published") || bool(m.meeting_room_relevant) === false) continue;
      const url = str(m.source_url);
      if (!isCitableUrl(url)) {
        diag({ kind: "dropped_hit", chunkId: id, detail: "linked context without citable URL" });
        continue;
      }
      out.push({
        sourceId: str(am.sourceId) ?? c.id ?? id,
        title: str(c.sourceTitle) ?? str(m.page_title) ?? "",
        sourceUrl: url,
        text: c.chunkContent ?? "",
      });
    }
    return out;
  }

  return {
    name: "hydra",
    async search(req: SearchRequest): Promise<SearchResponse> {
      const t0 = Date.now();
      const query = typeof req?.query === "string" ? req.query.trim() : "";
      if (!query) throw new HydraValidationError("search: query must be a non-empty string");
      const maxResults = Math.max(1, Math.min(50, Math.floor(req.maxResults ?? DEFAULT_MAX_RESULTS)));
      const exactTerms = cleanExactTerms(req.exactTerms);

      const { model, dropped } = buildModelFilters(req.filters);
      for (const d of dropped) diag({ kind: "dropped_filter_value", detail: d });

      let applied = withHardFilters(model);
      let relaxed = false;
      let run = await runQueries(query, applied, exactTerms);
      if (run.merged.length === 0 && Object.keys(model).length > 0) {
        applied = hardOnly();
        relaxed = true;
        run = await runQueries(query, applied, exactTerms);
      }

      const sources = sourcesById(run.main.data);
      for (const [k, v] of sourcesById(run.text?.data ?? {})) if (!sources.has(k)) sources.set(k, v);

      const perSource = new Map<string, number>();
      const hits: EvidenceHit[] = [];
      for (const c of run.merged) {
        if (hits.length >= maxResults) break;
        const h = toHit(c, sources, relaxed ? {} : model);
        if (!h) continue;
        const key = h.sourceId;
        const n = perSource.get(key) ?? 0;
        if (n >= PER_SOURCE_CAP) continue;
        perSource.set(key, n + 1);
        hits.push({ ref: `S${hits.length + 1}`, ...h });
      }
      const hitIds = new Set(hits.map((h) => h.chunkId));
      const linked = toLinked(run.main.data, hitIds);
      return {
        hits,
        graph: toGraph(run.main.data, hitIds),
        relaxed,
        appliedFilters: applied,
        ...(linked.length ? { linked } : {}),
        latencyMs: Date.now() - t0,
      };
    },
  };
}
