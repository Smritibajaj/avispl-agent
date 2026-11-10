import { test } from "node:test";
import assert from "node:assert/strict";
import { HYDRA_METADATA_SCHEMA, type SearchFilters } from "@avispl/shared";
import { buildModelFilters, HARD_FILTERS, withHardFilters } from "../filters";
import { checkSchemaLimits, fromWireMetadata, toSdkSchema, toWireMetadata, toWireSchema, wireFieldName, FILTERABLE_FIELDS } from "../schema";
import { checkRecordLimits, parseRecordsJsonl, toAppKnowledgeItem, ChunkMetadataKeysMatchSchema } from "../records";
import { mergeChunks, planSearch } from "../store";
import { resolveConfig, describeConfig } from "../config";
import { HydraError, redact } from "../errors";
import { toHydraError } from "../client";
import { SYNTHETIC_RECORDS } from "../fixtures/synthetic";
import { AppKnowledgeBatchSchema, CreateDatabaseRequestSchema, QueryRequestWireSchema } from "../wire";
import { HydraDBError } from "@hydradb/sdk";

const T = { database: "avispl_meeting_room_dev", collection: "meeting-room-journey" };

test("schema: purpose stripped, names/types/max_length/flags kept, enable_match on filter fields", () => {
  const wire = toWireSchema();
  assert.equal(wire.length, HYDRA_METADATA_SCHEMA.length);
  for (const [i, f] of wire.entries()) {
    const src = HYDRA_METADATA_SCHEMA[i]!;
    assert.equal(f.name, wireFieldName(src.name));
    assert.equal(f.data_type, src.data_type);
    assert.equal(f.max_length, src.max_length);
    assert.equal(!!f.enable_dense_embedding, !!src.enable_dense_embedding);
    assert.equal(!!f.enable_sparse_embedding, !!src.enable_sparse_embedding);
    assert.equal(!!f.enable_match, FILTERABLE_FIELDS.has(f.name));
    assert.ok(!("purpose" in f));
  }
  for (const k of FILTERABLE_FIELDS) assert.ok(wire.some((f) => f.name === k), `filter field ${k} must be declared`);
  assert.deepEqual(checkSchemaLimits(wire), []);
  assert.ok(CreateDatabaseRequestSchema.safeParse({ database: T.database, database_metadata_schema: wire }).success);
  const sdk = toSdkSchema();
  assert.equal(sdk.find((f) => f.name === "section")?.enableDenseEmbedding, true);
  assert.equal(sdk.find((f) => f.name === "status")?.enableMatch, true);
});

test("schema: source_url is reserved by HydraDB (probe 2026-11-10) -> declared and sent as page_url, read back as source_url", () => {
  const wire = toWireSchema();
  assert.ok(!wire.some((f) => f.name === "source_url"));
  assert.equal(wire.find((f) => f.name === "page_url")?.max_length, 512);
  assert.deepEqual(checkSchemaLimits([{ name: "source_url", data_type: "VARCHAR", max_length: 512 }]), ["reserved field name source_url"]);
  const item = toAppKnowledgeItem(SYNTHETIC_RECORDS[0]!, T, { withRelations: false });
  assert.ok(!("source_url" in item.metadata));
  assert.equal(item.metadata.page_url, SYNTHETIC_RECORDS[0]!.metadata.source_url);
  assert.deepEqual(checkRecordLimits(item), []);
  assert.ok(AppKnowledgeBatchSchema.safeParse([item]).success);
  assert.deepEqual(fromWireMetadata(toWireMetadata({ source_url: "u", status: "published" })), { source_url: "u", status: "published" });
});

test("ChunkMetadataSchema keys == HYDRA_METADATA_SCHEMA names (else HydraDB rejects or we never send a field)", () => {
  assert.deepEqual(ChunkMetadataKeysMatchSchema(), { missingInZod: [], missingInSchema: [] });
});

test("filters: operators per field, vocab-checked, hard filters always win", () => {
  const { model, dropped } = buildModelFilters({
    journey_stage: "plan_design",
    content_type: "case_study",
    industry: "legal",
    platforms: ["microsoft", "cisco"],
    vendors: ["neat"],
    topics: ["copilot", "not_a_topic" as never],
    room_size: "small",
  });
  assert.deepEqual(model, {
    journey_stage: { equals: "plan_design" },
    content_type: { equals: "case_study" },
    industry: { equals: "legal" },
    platforms: { contains_any: ["microsoft", "cisco"] },
    vendors: { contains_any: ["neat"] },
    topics: { contains_any: ["copilot"] },
    room_sizes: { contains: "small" },
  });
  assert.deepEqual(dropped, ["topics=not_a_topic"]);

  // A model trying to remove/override hard filters gets nowhere.
  const evil = { status: "needs_review", meeting_room_relevant: false, journey_stage: "deploy" } as unknown as SearchFilters;
  const all = withHardFilters(buildModelFilters(evil).model);
  assert.deepEqual(all.status, { equals: "published" });
  assert.deepEqual(all.meeting_room_relevant, { equals: true });
  assert.deepEqual(all.journey_stage, { equals: "deploy" });
  const injected = withHardFilters({ status: { equals: "needs_review" } });
  assert.deepEqual(injected.status, HARD_FILTERS.status);
  assert.deepEqual(buildModelFilters({ platforms: [] }).model, {});
  assert.deepEqual(buildModelFilters(undefined).model, {});
});

test("records: fixtures valid, golden_queries / priority / truncated URLs / commas rejected", () => {
  const good = SYNTHETIC_RECORDS.map((r) => JSON.stringify(r)).join("\n");
  const ok = parseRecordsJsonl(good);
  assert.equal(ok.problems.length, 0, JSON.stringify(ok.problems));
  assert.equal(ok.records.length, SYNTHETIC_RECORDS.length);

  const r0 = SYNTHETIC_RECORDS[0]!;
  const bad = [
    { ...r0, id: "a,b" },
    { ...r0, id: "x1", metadata: { ...r0.metadata, golden_queries: "Q1" } },
    { ...r0, id: "x2", metadata: { ...r0.metadata, priority: "P0" } },
    { ...r0, id: "x3", url: "https://www.avispl.com/some-page…" },
    { ...r0, id: "x4", metadata: { ...r0.metadata, source_url: "https://www.avispl.com/x..." } },
    { ...r0, id: "x5", additional: { contentHash: "h", goldenQueries: ["Q1"] } },
    { ...r0, id: "x6", metadata: { ...r0.metadata, journey_stage: "nope" } },
  ];
  const res = parseRecordsJsonl(bad.map((b) => JSON.stringify(b)).join("\n") + "\n{not json");
  assert.equal(res.records.length, 0);
  assert.equal(res.problems.length, bad.length + 1);
});

test("records: byte caps (UTF-8 bytes, not chars) and VARCHAR max_length in bytes", () => {
  const r = SYNTHETIC_RECORDS[0]!;
  const item = toAppKnowledgeItem(r, T, { withRelations: true });
  assert.deepEqual(checkRecordLimits(item), []);
  assert.deepEqual(item.relations, { ids: ["fx-plan-guide"] });
  assert.equal(toAppKnowledgeItem(r, T, { withRelations: false }).relations, undefined);
  assert.equal(item.additional_metadata.sourceId, r.sourceId);
  assert.deepEqual(item.fields, { kind: "knowledge_base", title: r.title, body: r.body });

  const big = { ...item, additional_metadata: { ...item.additional_metadata, crawlNotes: "é".repeat(500) } }; // 1000 bytes + keys
  assert.match(checkRecordLimits(big).join(), /additional_metadata is \d+ bytes/);
  const section = { ...item, metadata: { ...item.metadata, section: "é".repeat(100) } }; // 100 chars, 200 bytes > 160
  assert.match(checkRecordLimits(section).join(), /metadata.section is 200 bytes/);
  const undeclared = { ...item, metadata: { ...item.metadata, extra: "x" } };
  assert.match(checkRecordLimits(undeclared).join(), /not declared/);
  assert.ok(AppKnowledgeBatchSchema.safeParse([item]).success);
});

test("merge: dedupe by chunk id, hybrid order first, keyword-only hits can climb", () => {
  const c = (id: string, s = 0.5) => ({ chunkUuid: id, relevancyScore: s });
  const merged = mergeChunks([c("a"), c("b"), c("c")], [c("c", 0.9), c("d")]);
  assert.deepEqual(merged.map((x) => x.chunkUuid), ["c", "a", "b", "d"]);
  assert.equal(merged[0]!.relevancyScore, 0.9);
  assert.deepEqual(mergeChunks([c("a"), c("a")], []).map((x) => x.chunkUuid), ["a"]);
});

test("planSearch: main query params + optional keyword query, both valid wire requests", () => {
  const p = planSearch({ query: "q", filters: { room_size: "small" }, exactTerms: ["MTRX-4242"] }, T);
  assert.equal(p.requests.length, 2);
  const [main, text] = p.requests as Record<string, any>[];
  assert.equal(main!.query_by, "hybrid");
  assert.equal(main!.mode, "thinking");
  assert.equal(main!.max_results, 20);
  assert.equal(main!.alpha, 0.8);
  assert.equal(main!.recency_bias, 0.1);
  assert.equal(main!.graph_context, true);
  assert.equal(main!.query_forceful_relations, true);
  assert.deepEqual(main!.metadata_filters, { room_sizes: { contains: "small" }, status: { equals: "published" }, meeting_room_relevant: { equals: true } });
  assert.equal(text!.query_by, "text");
  for (const r of p.requests) assert.ok(QueryRequestWireSchema.safeParse(r).success, JSON.stringify(QueryRequestWireSchema.safeParse(r).error?.issues));
});

test("config + errors never expose the key", () => {
  const c = resolveConfig({}, { HYDRADB_API_KEY: "sk_live_SECRET123", HYDRADB_DATABASE: "avispl_meeting_room_dev" });
  assert.equal(c.baseUrl, "https://api.hydradb.com");
  assert.equal(c.collection, "meeting-room-journey");
  assert.ok(!describeConfig(c).includes("SECRET123"));
  assert.throws(() => resolveConfig({}, { HYDRADB_DATABASE: "x" }), /HYDRADB_API_KEY/);
  assert.throws(() => resolveConfig({}, { HYDRADB_API_KEY: "k", HYDRADB_DATABASE: "Bad Name" }), /must match/);
  assert.ok(!redact("Authorization: Bearer sk_live_SECRET123").includes("SECRET123"));
  const e = toHydraError(new HydraDBError({ statusCode: 400, body: { error: { code: "INVALID_INPUT", message: "bad" }, meta: { requestId: "r1" } } }), "POST /query");
  assert.ok(e instanceof HydraError);
  assert.equal(e.status, 400);
  assert.equal(e.code, "INVALID_INPUT");
  assert.equal(e.requestId, "r1");
});
