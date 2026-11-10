/**
 * smoke — live facts about HydraDB v2, DEV database ONLY (avispl_meeting_room_dev), <= 20 synthetic records.
 *
 * Records: section = "SMOKE TEST", status = "needs_review", URLs on the reserved .example domain.
 * Measures: ingest -> graph_creation / completed time, `contains` semantics (token vs substring), which chunk
 * metadata fields come back, graph_context / additional_context shape, data.sources presence, latency per
 * mode, undeclared-key + size-cap behaviour. Deletes its records afterwards (DELETE /context, strict) unless --keep.
 *
 * Usage: pnpm hydra smoke [--dry-run] [--keep] [--no-write]
 *   Against a local mock (HYDRADB_BASE_URL=http://localhost:4010) it rehearses the flow but never writes
 *   to docs/DECISIONS.md (mock facts are not HydraDB facts).
 */
import { EMPTY_METADATA_DEFAULTS, HYDRA_METADATA_SCHEMA, type ChunkMetadata, type IngestRecord } from "@avispl/shared";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { HydraApi, type AppKnowledgeItem } from "../client";
import { DEV_DATABASE, isMockBaseUrl } from "../config";
import { ensureDatabase } from "../database";
import { HydraError, HydraValidationError } from "../errors";
import { runIngest, type IngestReport } from "../ingest";
import { IngestRecordSchema, toAppKnowledgeItem } from "../records";
import { wireFieldName } from "../schema";
import { createHydraKnowledgeStore } from "../store";
import { AppKnowledgeBatchSchema, QueryRequestWireSchema } from "../wire";
import { PKG_ROOT, REPO_ROOT, parseArgs, printJson, run, scriptConfig, sleep } from "./common";

const MAX_SMOKE_RECORDS = 20;
const SECTION = "SMOKE TEST";

function smokeRecords(runId: string): IngestRecord[] {
  const mk = (n: number, meta: Partial<ChunkMetadata>, body: string, relationIds: number[] = []): IngestRecord => {
    const id = `smoke-${runId}-${n}`;
    const url = `https://smoke.example/hydra/${runId}/${n}`;
    return {
      id,
      sourceId: `smoke-source-${n}`,
      title: `SMOKE TEST record ${n}`,
      url,
      body: `SYNTHETIC SMOKE TEST RECORD ${n}. Not AVI-SPL content; delete on sight.\n\n${body}`,
      metadata: {
        ...EMPTY_METADATA_DEFAULTS,
        journey_stage: "plan_design",
        content_type: "page",
        status: "needs_review",
        section: SECTION,
        source_url: url,
        page_title: `Smoke test page ${n}`,
        last_crawled: "2026-11-10",
        last_modified: "2026-11-10",
        ...meta,
      } as ChunkMetadata,
      additional: { contentHash: `smoke-${runId}-${n}` },
      relationIds: relationIds.map((r) => `smoke-${runId}-${r}`),
      timestamp: "2026-11-10T00:00:00Z",
    };
  };
  return [
    mk(1, { platforms: "microsoft,cisco", topics: "meeting_equity,standardization", room_sizes: "small,medium", vendors: "neat" },
      "The Fjordlantern huddle room uses a Neat Bar camera mounted below the display. Contoso Facilities manages every Fjordlantern room. Remote participants see each person at equal size.", [6]),
    mk(2, { platforms: "zoom", topics: "meeting_equity", room_sizes: "large", vendors: "logitech" },
      "The Fjordlantern boardroom runs Zoom Rooms with a Logitech Rally system. Contoso Facilities trained the staff in March."),
    mk(3, { platforms: "cisco", topics: "roi", room_sizes: "medium", journey_stage: "choose_platform" },
      "Cisco Webex devices were evaluated by Contoso Procurement for the Fjordlantern program."),
    mk(4, { meeting_room_relevant: false, topics: "sustainability" },
      "An off-scope Fjordlantern video wall in the lobby, not a meeting room."),
    mk(5, { platforms: "microsoft", topics: "copilot", requires_disclosure: true, content_type: "ebook" },
      "The literal synthetic part number XQ9000SMOKE identifies the Fjordlantern Teams Rooms kit."),
    mk(6, { topics: "standardization", content_type: "pdf", page_range: "4-7", edition: "2025-winter" },
      "Fjordlantern standard room template: one display for huddle rooms, two displays for medium rooms."),
    mk(7, { journey_stage: "proof", content_type: "case_study", cs_organization: "Smoke Test Org", cs_location: "Nowhere", cs_rooms_count: 12, legacy_platform: true, industry: "legal" },
      "Smoke Test Org deployed twelve Fjordlantern rooms on a legacy platform."),
    mk(8, { journey_stage: "run_support", content_type: "support_info", topics: "monitoring", metrics_are_estimates: true },
      "Fjordlantern rooms are monitored remotely; incidents are escalated to Contoso Support."),
  ];
}

const BASE_FILTER = { section: { equals: SECTION }, status: { equals: "needs_review" } };

interface QueryFact {
  name: string;
  request: Record<string, unknown>;
  httpStatus: number;
  ms: number;
  serverLatencyMs?: unknown;
  matchedRecords: string[];
  chunkCount: number;
  error?: unknown;
}

const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};
const stats = (xs: number[]) => (xs.length ? { min: Math.min(...xs), median: median(xs), max: Math.max(...xs), n: xs.length } : { n: 0 });

run(async () => {
  const args = parseArgs();
  const dryRun = args.flags.has("dry-run");
  if (args.values.get("database") && args.values.get("database") !== DEV_DATABASE)
    throw new HydraError("config", `smoke runs against ${DEV_DATABASE} only`);
  args.values.set("database", DEV_DATABASE);
  const cfg = scriptConfig(args, { write: true, dryRun });
  if (cfg.database !== DEV_DATABASE) throw new HydraError("config", `smoke runs against ${DEV_DATABASE} only`);
  const mock = isMockBaseUrl(cfg.baseUrl);

  const runId = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const records = smokeRecords(runId);
  if (records.length > MAX_SMOKE_RECORDS) throw new HydraError("config", `smoke is capped at ${MAX_SMOKE_RECORDS} records`);
  for (const r of records) {
    const v = IngestRecordSchema.safeParse(r);
    if (!v.success) throw new HydraValidationError(`smoke record ${r.id} invalid`, v.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  const items = records.map((r) => toAppKnowledgeItem(r, cfg, { withRelations: false }));
  const bv = AppKnowledgeBatchSchema.safeParse(items);
  if (!bv.success) throw new HydraValidationError("smoke items invalid", bv.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  const rid = (n: number) => `smoke-${runId}-${n}`;

  const queryBodies: [string, Record<string, unknown>][] = [
    ["thinking_baseline", { query: "Fjordlantern huddle room camera Contoso", query_by: "hybrid", mode: "thinking", alpha: 0.8, recency_bias: 0.1, graph_context: true, query_forceful_relations: true, max_results: 20, metadata_filters: BASE_FILTER }],
    ["contains_full_token_meeting_equity", { query: "Fjordlantern room", query_by: "hybrid", mode: "fast", max_results: 20, metadata_filters: { ...BASE_FILTER, topics: { contains: "meeting_equity" } } }],
    ["contains_substring_probe_equity", { query: "Fjordlantern room", query_by: "hybrid", mode: "fast", max_results: 20, metadata_filters: { ...BASE_FILTER, topics: { contains: "equity" } } }],
    ["contains_second_position_cisco", { query: "Fjordlantern", query_by: "hybrid", mode: "fast", max_results: 20, metadata_filters: { ...BASE_FILTER, platforms: { contains: "cisco" } } }],
    ["contains_any_zoom_cisco", { query: "Fjordlantern", query_by: "hybrid", mode: "fast", max_results: 20, metadata_filters: { ...BASE_FILTER, platforms: { contains_any: ["zoom", "cisco"] } } }],
    ["equals_on_comma_field_cisco", { query: "Fjordlantern", query_by: "hybrid", mode: "fast", max_results: 20, metadata_filters: { ...BASE_FILTER, platforms: { equals: "cisco" } } }],
    ["bool_equals_false", { query: "Fjordlantern", query_by: "hybrid", mode: "fast", max_results: 20, metadata_filters: { ...BASE_FILTER, meeting_room_relevant: { equals: false } } }],
    ["undeclared_key_filter", { query: "Fjordlantern", query_by: "hybrid", mode: "fast", max_results: 20, metadata_filters: { ...BASE_FILTER, not_declared_field: { equals: "x" } } }],
    ["valid_filter_no_match", { query: "Fjordlantern", query_by: "hybrid", mode: "fast", max_results: 20, metadata_filters: { ...BASE_FILTER, journey_stage: { equals: "deploy" } } }],
    ["nested_additional_metadata", { query: "Fjordlantern", query_by: "hybrid", mode: "fast", max_results: 20, metadata_filters: { ...BASE_FILTER, additional_metadata: { contentHash: `smoke-${runId}-3` } } }],
    ["text_exact_token", { query: "XQ9000SMOKE", query_by: "text", max_results: 20, graph_context: false, metadata_filters: BASE_FILTER }],
    ["fast_no_graph", { query: "Fjordlantern huddle room camera Contoso", query_by: "hybrid", mode: "fast", graph_context: false, max_results: 20, metadata_filters: BASE_FILTER }],
  ];
  const withScope = (b: Record<string, unknown>) => ({ database: cfg.database, collection: cfg.collection, type: "knowledge", response_format: "structured", ...b });

  if (dryRun) {
    printJson(`DRY RUN: ${records.length} smoke items (phase 1, no relations)`, items.map((i) => ({ id: i.id, metadata: i.metadata })));
    for (const [name, b] of queryBodies) printJson(`DRY RUN query ${name}`, withScope(b));
    console.log("[hydra] validated, nothing sent");
    return;
  }

  const api = new HydraApi(cfg, { maxRetries: 2 });
  const facts: Record<string, unknown> = { runId, at: new Date().toISOString(), baseUrl: cfg.baseUrl, database: cfg.database, collection: cfg.collection, mock, sdk: "@hydradb/sdk 2.1.8" };
  const ingested = new Set<string>();
  try {
    // 1. database
    const db = await ensureDatabase(api, { timeoutMs: 600_000, log: (l) => console.log(l), intervalMs: mock ? 200 : 3000 });
    facts.database_create = { created: db.created, waitedMs: db.waitedMs, infra: db.infra };

    // 2. rejection probes (fail before ingestion, cost nothing)
    const probe = async (name: string, item: AppKnowledgeItem) => {
      try {
        const r = await api.ingestAppKnowledge([item]);
        if (r.successCount) ingested.add(item.id);
        return { name, accepted: true, result: r.results[0] };
      } catch (e) {
        const he = e as HydraError;
        return { name, accepted: false, status: he.status, code: he.code, message: he.message };
      }
    };
    const item0 = toAppKnowledgeItem(records[0]!, cfg, { withRelations: false });
    const badKey = { ...item0, id: rid(91), metadata: { ...item0.metadata, not_declared_field: "x" } };
    const bigAdd = { ...toAppKnowledgeItem(records[0]!, cfg, { withRelations: false }), id: rid(92), additional_metadata: { contentHash: "x".repeat(1100) } };
    facts.ingest_rejections = [await probe("undeclared_metadata_key", badKey), await probe("additional_metadata_over_1KiB", bigAdd)];

    // 3. ingest (two phases)
    for (const r of records) ingested.add(r.id);
    const report: IngestReport = await runIngest(api, records, { batchSize: 20, pollIntervalMs: mock ? 100 : 2000, pollTimeoutMs: 20 * 60_000, log: (l) => console.log(l) });
    const p1 = report.phase1;
    const tGraph = Object.values(p1.firstSeenMs).map((m) => m.graph_creation ?? m.completed).filter((x): x is number => typeof x === "number");
    const tDone = Object.values(p1.firstSeenMs).map((m) => m.completed).filter((x): x is number => typeof x === "number");
    facts.ingest = {
      phase1: { sent: p1.sent, accepted: p1.accepted, completed: p1.completed.length, errored: p1.errored, pending: p1.pending, ms_to_graph_creation: stats(tGraph), ms_to_completed: stats(tDone), statuses_seen: [...new Set(Object.values(p1.firstSeenMs).flatMap((m) => Object.keys(m)))] },
      phase2: report.phase2 && { sent: report.phase2.sent, completed: report.phase2.completed.length, relationsCreated: report.phase2.relationsCreated, relationsErrors: report.phase2.relationsErrors, errored: report.phase2.errored, durationMs: report.phase2.durationMs },
    };

    // 4. queries (raw wire JSON through the SDK passthrough)
    const qfacts: QueryFact[] = [];
    let baseline: Record<string, any> | undefined;
    for (const [name, b] of queryBodies) {
      const body = withScope(b);
      const wv = QueryRequestWireSchema.safeParse(body);
      if (!wv.success && !name.startsWith("undeclared") && !name.startsWith("nested")) console.log(`  (note: ${name} is outside our own wire schema: ${wv.error.issues[0]?.message})`);
      const r = await api.rawJson("/query", { method: "POST", body }, { timeoutMs: 60_000 });
      const j = r.json as Record<string, any>;
      const chunks: Record<string, any>[] = Array.isArray(j?.data?.chunks) ? j.data.chunks : [];
      const matched = [...new Set(chunks.map((c) => String(c.id)))].map((id) => id.replace(`smoke-${runId}-`, "#")).sort();
      qfacts.push({ name, request: b, httpStatus: r.status, ms: r.ms, serverLatencyMs: j?.meta?.latency_ms, matchedRecords: matched, chunkCount: chunks.length, ...(r.status >= 400 ? { error: j?.error } : {}) });
      console.log(`  query ${name}: HTTP ${r.status} ${r.ms}ms chunks=${chunks.length} records=${matched.join(",")}`);
      if (name === "thinking_baseline") baseline = j;
    }
    facts.queries = qfacts;

    // 5. response shape from the baseline thinking query
    const d = (baseline?.data ?? {}) as Record<string, any>;
    const chunks: Record<string, any>[] = d.chunks ?? [];
    const declared = HYDRA_METADATA_SCHEMA.map((f) => wireFieldName(f.name)); // names as declared in HydraDB
    const returnedKeys = new Set(chunks.flatMap((c) => Object.keys(c.metadata ?? {})));
    const gc = d.graph_context ?? {};
    const qp: Record<string, any>[] = gc.query_paths ?? [];
    const chunkIds = new Set(chunks.map((c) => c.chunk_uuid));
    const pathChunkIds = qp.flatMap((p) => p.source_chunk_ids ?? []);
    facts.response_shape = {
      data_keys: Object.keys(d),
      meta_keys: Object.keys(baseline?.meta ?? {}),
      chunk_keys: [...new Set(chunks.flatMap((c) => Object.keys(c)))],
      chunk_uuid_examples: chunks.slice(0, 3).map((c) => c.chunk_uuid),
      chunks_per_record: Object.fromEntries([...new Set(chunks.map((c) => c.id))].map((id) => [id, chunks.filter((c) => c.id === id).length])),
      metadata_fields_returned: declared.filter((k) => returnedKeys.has(k)),
      metadata_fields_missing: declared.filter((k) => !returnedKeys.has(k)),
      metadata_extra_keys: [...returnedKeys].filter((k) => !declared.includes(k)),
      metadata_value_types: Object.fromEntries(Object.entries(chunks[0]?.metadata ?? {}).map(([k, v]) => [k, typeof v])),
      additional_metadata_returned: chunks.some((c) => c.additional_metadata && Object.keys(c.additional_metadata).length > 0),
      additional_metadata_example: chunks[0]?.additional_metadata,
      sources_present: Array.isArray(d.sources),
      sources_example: Array.isArray(d.sources) ? d.sources.slice(0, 2) : undefined,
      graph_context_keys: Object.keys(gc),
      query_paths: qp.length,
      chunk_relations: (gc.chunk_relations ?? []).length,
      triplet_example: qp[0]?.triplets?.[0],
      path_keys: [...new Set(qp.flatMap((p) => Object.keys(p)))],
      source_chunk_ids_resolve_to_returned_chunks: pathChunkIds.length ? pathChunkIds.filter((x) => chunkIds.has(x)).length / pathChunkIds.length : null,
      origin_present: JSON.stringify(gc).includes('"origin"'),
      additional_context_keys: Object.keys(d.additional_context ?? {}),
      additional_context_record_ids: Object.values(d.additional_context ?? {}).map((c: any) => c?.id),
      forceful_relation_target_found: Object.values(d.additional_context ?? {}).some((c: any) => c?.id === rid(6)) || chunks.some((c) => c.id === rid(6)),
      forceful_relations_field: d.forceful_relations,
    };

    // 6. latency: thinking x3, fast x3
    const lat = async (mode: string) => {
      const xs: number[] = [];
      for (let i = 0; i < 3; i++) {
        const r = await api.rawJson("/query", { method: "POST", body: withScope({ query: "Fjordlantern room template displays", query_by: "hybrid", mode, max_results: 20, metadata_filters: BASE_FILTER }) }, { timeoutMs: 60_000 });
        xs.push(r.ms);
      }
      return stats(xs);
    };
    facts.latency_ms = { thinking: await lat("thinking"), fast: await lat("fast") };

    // 7. the store itself: hard filters must hide needs_review smoke records
    const store = createHydraKnowledgeStore({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, database: cfg.database, collection: cfg.collection, timeoutMs: 30_000 });
    const sr = await store.search({ query: "Fjordlantern huddle room camera", filters: { room_size: "small" } });
    facts.store_hard_filter = { hits: sr.hits.length, smokeHits: sr.hits.filter((h) => h.chunkId.includes(`smoke-${runId}`) || h.sourceUrl.includes("smoke.example")).length, relaxed: sr.relaxed, latencyMs: sr.latencyMs };
  } finally {
    // 8. cleanup
    if (!args.flags.has("keep") && ingested.size) {
      const ids = [...ingested];
      let result: unknown;
      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          result = await api.deleteContext(ids);
          break;
        } catch (e) {
          const he = e as HydraError;
          result = { status: he.status, code: he.code, message: he.message };
          if (he.status === 409) {
            await sleep(mock ? 200 : 5000);
            continue;
          }
          break;
        }
      }
      facts.cleanup = { ids: ids.length, result };
      console.log(`[hydra] cleanup: ${JSON.stringify(result).slice(0, 300)}`);
    }
  }

  const dir = join(PKG_ROOT, "smoke-results");
  await mkdir(dir, { recursive: true });
  const out = join(dir, `smoke-${mock ? "MOCK-" : ""}${runId}.json`);
  await writeFile(out, JSON.stringify(facts, null, 2));
  console.log(`[hydra] facts written: ${out}`);
  if (!mock && !args.flags.has("no-write")) await appendDecisions(facts);
});

async function appendDecisions(f: Record<string, any>) {
  const path = join(REPO_ROOT, "docs", "DECISIONS.md");
  const cur = await readFile(path, "utf8");
  const header = "## 5. Verified by hydra-agent";
  const q = Object.fromEntries((f.queries as QueryFact[]).map((x) => [x.name, x]));
  const rs = f.response_shape ?? {};
  const sub = q.contains_substring_probe_equity;
  const lines = [
    "",
    `### Smoke run ${f.runId} (${f.at}, ${f.database}, ${f.sdk})`,
    `- Ingest: phase1 ${f.ingest?.phase1?.completed}/${f.ingest?.phase1?.sent} completed; ms to graph_creation ${JSON.stringify(f.ingest?.phase1?.ms_to_graph_creation)}; ms to completed ${JSON.stringify(f.ingest?.phase1?.ms_to_completed)}; statuses seen ${JSON.stringify(f.ingest?.phase1?.statuses_seen)}.`,
    `- Phase 2 relations: ${JSON.stringify(f.ingest?.phase2 ?? null)}`,
    `- contains semantics: topics contains "equity" (substring of meeting_equity) -> HTTP ${sub?.httpStatus}, records ${JSON.stringify(sub?.matchedRecords)} => ${sub?.matchedRecords?.length ? "SUBSTRING match" : "token (comma-member) match"}; contains "cisco" on "microsoft,cisco" -> ${JSON.stringify(q.contains_second_position_cisco?.matchedRecords)}; equals "cisco" -> ${JSON.stringify(q.equals_on_comma_field_cisco?.matchedRecords)}; contains_any [zoom,cisco] -> ${JSON.stringify(q.contains_any_zoom_cisco?.matchedRecords)}.`,
    `- BOOL equals false -> ${JSON.stringify(q.bool_equals_false?.matchedRecords)}; undeclared filter key -> HTTP ${q.undeclared_key_filter?.httpStatus} records ${JSON.stringify(q.undeclared_key_filter?.matchedRecords)}; valid no-match filter -> ${JSON.stringify(q.valid_filter_no_match?.matchedRecords)}; nested additional_metadata -> ${JSON.stringify(q.nested_additional_metadata?.matchedRecords)}; text query exact token -> ${JSON.stringify(q.text_exact_token?.matchedRecords)}.`,
    `- Chunk metadata returned: ${JSON.stringify(rs.metadata_fields_returned)}; MISSING: ${JSON.stringify(rs.metadata_fields_missing)}; additional_metadata returned: ${rs.additional_metadata_returned}; data.sources present: ${rs.sources_present}.`,
    `- data keys ${JSON.stringify(rs.data_keys)}; chunk keys ${JSON.stringify(rs.chunk_keys)}; chunks per record ${JSON.stringify(rs.chunks_per_record)}.`,
    `- graph_context: keys ${JSON.stringify(rs.graph_context_keys)}, query_paths ${rs.query_paths}, chunk_relations ${rs.chunk_relations}, path keys ${JSON.stringify(rs.path_keys)}, source_chunk_ids resolving to returned chunks ${rs.source_chunk_ids_resolve_to_returned_chunks}, origin present ${rs.origin_present}. Example triplet: \`${JSON.stringify(rs.triplet_example ?? null)}\``,
    `- additional_context: ${JSON.stringify(rs.additional_context_keys?.length)} entries, record ids ${JSON.stringify(rs.additional_context_record_ids)}; forceful-relation target found: ${rs.forceful_relation_target_found}; forceful_relations field: ${JSON.stringify(rs.forceful_relations_field ?? null)}.`,
    `- Latency (client wall ms, 20 results, filtered): thinking ${JSON.stringify(f.latency_ms?.thinking)}, fast ${JSON.stringify(f.latency_ms?.fast)}.`,
    `- Ingest rejections: ${JSON.stringify((f.ingest_rejections ?? []).map((r: any) => ({ name: r.name, accepted: r.accepted, status: r.status, code: r.code })))}.`,
    `- Store hard filters hide needs_review records: ${JSON.stringify(f.store_hard_filter)}.`,
    `- Cleanup: ${JSON.stringify(f.cleanup ?? "kept (--keep)").slice(0, 300)}`,
  ];
  const text = cur.includes(header) ? lines.join("\n") + "\n" : `\n${header}\n\nFacts written by \`pnpm hydra smoke\` (packages/hydra/src/scripts/smoke.ts). Raw JSON in packages/hydra/smoke-results/.\n${lines.join("\n")}\n`;
  await appendFile(path, text);
  console.log(`[hydra] appended findings to ${path}`);
}
