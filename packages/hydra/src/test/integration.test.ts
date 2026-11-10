/**
 * Integration: real SDK client -> local mock server (random port) -> ingest -> createHydraKnowledgeStore.
 * Proves PLUMBING only (wire shapes, filters, relax retry, merge/dedupe/cap, mapping). Not relevance, not graph.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { startMockServer, type RunningMock } from "../mock-server/server";
import { HydraApi } from "../client";
import { resolveConfig } from "../config";
import { ensureDatabase } from "../database";
import { HydraError, HydraValidationError } from "../errors";
import { runIngest, type IngestReport } from "../ingest";
import { toAppKnowledgeItem } from "../records";
import { createHydraKnowledgeStore, type StoreDiagnostic } from "../store";
import { SYNTHETIC_RECORDS } from "../fixtures/synthetic";

let mock: RunningMock;
let api: HydraApi;
let report: IngestReport;
const DB = "avispl_meeting_room_dev";
const COLL = "meeting-room-journey";
const diags: StoreDiagnostic[] = [];
let store: ReturnType<typeof createHydraKnowledgeStore>;

before(async () => {
  mock = await startMockServer({ port: 0, readyAfterMs: 150, stepMs: 40 });
  api = new HydraApi(resolveConfig({ apiKey: "test-key-not-secret", baseUrl: mock.url, database: DB, collection: COLL }, {}), { maxRetries: 0 });
  store = createHydraKnowledgeStore({ apiKey: "test-key-not-secret", baseUrl: mock.url, database: DB, collection: COLL, onDiagnostic: (d) => diags.push(d) });
});
after(async () => {
  await mock?.close();
});

test("before creation: typed 404 DATABASE_NOT_FOUND", async () => {
  await assert.rejects(api.databaseStatus(), (e: unknown) => e instanceof HydraError && e.status === 404 && e.code === "DATABASE_NOT_FOUND");
});

test("db:create flow: create, wait ready, idempotent on 409", async () => {
  const r = await ensureDatabase(api, { timeoutMs: 5000, intervalMs: 50 });
  assert.equal(r.created, true);
  assert.equal(r.readyForIngestion, true);
  assert.ok(r.waitedMs >= 100, `waited ${r.waitedMs}ms`);
  const again = await api.createDatabase([]);
  assert.equal(again.created, false);
});

test("ingest: two phases, all completed, relations only in phase 2", async () => {
  report = await runIngest(api, SYNTHETIC_RECORDS, { batchSize: 5, pollIntervalMs: 30, pollTimeoutMs: 10_000 });
  assert.equal(report.precheckFailures.length, 0);
  assert.equal(report.phase1.sent, SYNTHETIC_RECORDS.length);
  assert.equal(report.phase1.completed.length, SYNTHETIC_RECORDS.length);
  assert.deepEqual(report.phase1.errored, []);
  assert.ok(report.phase2, "phase 2 ran");
  assert.equal(report.phase2!.sent, 1);
  assert.equal(report.phase2!.relationsCreated, 1);
  assert.deepEqual(report.phase2!.relationsErrors, []);
  const seen = Object.values(report.phase1.firstSeenMs).flatMap((m) => Object.keys(m));
  assert.ok(seen.includes("completed"));
});

test("mock enforces API rules: undeclared metadata key and size caps are 400", async () => {
  const base = toAppKnowledgeItem(SYNTHETIC_RECORDS[0]!, { database: DB, collection: COLL }, { withRelations: false });
  await assert.rejects(
    api.ingestAppKnowledge([{ ...base, id: "bad-1", metadata: { ...base.metadata, golden_queries: "Q1" } }]),
    (e: unknown) => e instanceof HydraError && e.status === 400 && /not declared/.test(e.message),
  );
  await assert.rejects(
    api.ingestAppKnowledge([{ ...base, id: "bad-2", additional_metadata: { contentHash: "x".repeat(1100) } }]),
    (e: unknown) => e instanceof HydraError && e.status === 400 && /additional_metadata is too large/.test(e.message),
  );
  await assert.rejects(
    api.ingestAppKnowledge([{ ...base, id: "bad-3", metadata: { ...base.metadata, cs_rooms_count: "40" as unknown as number } }]),
    (e: unknown) => e instanceof HydraError && e.status === 400,
  );
  const st = await api.contextStatus(["bad-1", "bad-2", "fx-plan-small"]);
  assert.deepEqual(st.map((s) => s.indexingStatus), ["errored", "errored", "completed"]);
  assert.equal(st[0]!.errorCode, "FILE_NOT_FOUND");
});

test("raw responses carry meta.mock=true; undeclared filter key -> empty (no widening)", async () => {
  const r = await api.rawJson("/query", { method: "POST", body: { database: DB, collection: COLL, query: "zebrafruit", metadata_filters: { not_declared: { equals: "x" } } } });
  assert.equal(r.status, 200);
  const j = r.json as any;
  assert.equal(j.meta.mock, true);
  assert.deepEqual(j.data.chunks, []);
  const bad = await api.rawJson("/query", { method: "POST", body: { database: DB, collection: COLL, query: "zebrafruit", metadata_filters: { platforms: { contains: "x", equals: "y" } } } });
  assert.equal(bad.status, 400);
  const boolContains = await api.rawJson("/query", { method: "POST", body: { database: DB, collection: COLL, query: "zebrafruit", metadata_filters: { legacy_platform: { contains: "true" } } } });
  assert.equal(boolContains.status, 400);
});

const ids = (hits: { chunkId: string }[]) => hits.map((h) => h.chunkId.replace(/_chunk_\d+$/, ""));

test("store: hard filters hide needs_review and off-scope; refs S1..Sn; hard filters reported", async () => {
  const res = await store.search({ query: "zebrafruit rooms" });
  assert.ok(res.hits.length > 0);
  const found = ids(res.hits);
  assert.ok(!found.includes("fx-unpublished"));
  assert.ok(!found.includes("fx-offscope"));
  assert.deepEqual(res.hits.map((h) => h.ref), res.hits.map((_, i) => `S${i + 1}`));
  assert.equal(res.relaxed, false);
  assert.deepEqual(res.appliedFilters, { status: { equals: "published" }, meeting_room_relevant: { equals: true } });
  assert.deepEqual(res.graph, []); // the mock has no graph
  assert.equal(typeof res.latencyMs, "number");
});

test("store: room_size -> contains on comma list; platforms -> contains_any (2nd position)", async () => {
  const small = await store.search({ query: "zebrafruit rooms", filters: { room_size: "small" } });
  assert.deepEqual(ids(small.hits), ["fx-plan-small"]);
  assert.equal(small.relaxed, false);
  const cisco = await store.search({ query: "zebrafruit", filters: { platforms: ["cisco"] } });
  assert.deepEqual(ids(cisco.hits), ["fx-plan-large"]);
  const stage = await store.search({ query: "zebrafruit", filters: { journey_stage: "proof", industry: "financial_services" } });
  assert.deepEqual(ids(stage.hits), ["fx-proof-legacy"]);
});

test("store: relax-and-retry with ONLY hard filters when model filters match nothing", async () => {
  const res = await store.search({ query: "zebrafruit", filters: { journey_stage: "run_support", vendors: ["shure"] } });
  assert.equal(res.relaxed, true);
  assert.ok(res.hits.length > 0);
  assert.deepEqual(res.appliedFilters, { status: { equals: "published" }, meeting_room_relevant: { equals: true } });
  assert.ok(!ids(res.hits).includes("fx-unpublished"));
});

test("store: at most 3 chunks per source", async () => {
  const res = await store.search({ query: "wombatcap deployment section" });
  const cap = res.hits.filter((h) => h.sourceId === "fx-cap-source");
  assert.equal(cap.length, 3);
});

test("store: exactTerms runs a keyword query in parallel and merges (dedupe by chunk id)", async () => {
  const without = await store.search({ query: "zebrafruit planning" });
  assert.ok(!ids(without.hits).includes("fx-platform-ms"));
  const withExact = await store.search({ query: "zebrafruit planning", exactTerms: ["MTRX-4242"] });
  assert.ok(ids(withExact.hits).includes("fx-platform-ms"));
  const uniq = new Set(withExact.hits.map((h) => h.chunkId));
  assert.equal(uniq.size, withExact.hits.length);
});

test("store: EvidenceHit mapping from chunk metadata; linked from forceful relations; maxResults", async () => {
  const res = await store.search({ query: "zebrafruit case study bank", filters: { content_type: "case_study" } });
  const h = res.hits[0]!;
  assert.equal(h.sourceId, "fx-proof");
  assert.equal(h.contentType, "case_study");
  assert.equal(h.journeyStage, "proof");
  assert.equal(h.csOrganization, "Synthetic Bank");
  assert.equal(h.csRoomsCount, 40);
  assert.equal(h.flags.legacyPlatform, true);
  assert.equal(h.flags.requiresDisclosure, false);
  assert.equal(h.sourceUrl, "https://synthetic.example/fixtures/fx-proof");
  assert.equal(h.section, "Legacy case");
  assert.equal(h.title, "Synthetic › Legacy case");

  const linked = await store.search({ query: "zebrafruit small rooms camera" });
  assert.ok(ids(linked.hits).includes("fx-plan-small"));
  assert.ok(!ids(linked.hits).includes("fx-plan-guide"));
  assert.equal(linked.linked?.length, 1);
  assert.equal(linked.linked![0]!.sourceId, "fx-plan-guide");
  assert.equal(linked.linked![0]!.sourceUrl, "https://synthetic.example/fixtures/fx-plan-guide");
  // Linked results follow the request's filters (docs): fx-plan-guide has no room_sizes, so it is not pulled in here.
  const filtered = await store.search({ query: "zebrafruit small rooms camera", filters: { room_size: "small" } });
  assert.deepEqual(ids(filtered.hits), ["fx-plan-small"]);
  assert.equal(filtered.linked, undefined);

  const two = await store.search({ query: "zebrafruit", maxResults: 2 });
  assert.equal(two.hits.length, 2);
  const disclosure = await store.search({ query: "platform notes part number", exactTerms: ["MTRX-4242"] });
  assert.equal(disclosure.hits.find((x) => x.sourceId === "fx-platform")?.flags.requiresDisclosure, true);
  assert.deepEqual(diags.filter((d) => d.kind === "missing_chunk_metadata"), []);
});

test("store: typed errors (empty query, wrong key scope)", async () => {
  await assert.rejects(store.search({ query: "   " }), (e: unknown) => e instanceof HydraValidationError);
  const other = createHydraKnowledgeStore({ apiKey: "k", baseUrl: mock.url, database: "does_not_exist", collection: COLL });
  await assert.rejects(other.search({ query: "x" }), (e: unknown) => e instanceof HydraError && e.status === 404 && !String(e.message).includes("Bearer"));
  const noKey = createHydraKnowledgeStore({ baseUrl: mock.url, database: DB, env: {} });
  await assert.rejects(noKey.search({ query: "x" }), /HYDRADB_API_KEY/);
});

test("cleanup: DELETE /context strict", async () => {
  const r = (await api.deleteContext(["fx-cap-4"])) as Record<string, unknown>;
  assert.equal(r.deletedCount ?? r.deleted_count, 1);
  const res = await store.search({ query: "wombatcap deployment section" });
  assert.ok(!ids(res.hits).includes("fx-cap-4"));
});

test("store maps the mock's metadata graph to GraphTriplet with chunkIds that are hit chunkIds", async () => {
  const g = await startMockServer({ port: 0, readyAfterMs: 0, stepMs: 0, graph: "metadata" });
  try {
    const cfg = { apiKey: "k", baseUrl: g.url, database: DB, collection: COLL };
    const a = new HydraApi(resolveConfig(cfg, {}), { maxRetries: 0 });
    await ensureDatabase(a, { intervalMs: 10 });
    await runIngest(a, SYNTHETIC_RECORDS, { pollIntervalMs: 10, skipRelations: true });
    const res = await createHydraKnowledgeStore(cfg).search({ query: "zebrafruit case study bank" });
    assert.ok(res.graph.length > 0);
    const hitIds = new Set(res.hits.map((h) => h.chunkId));
    for (const t of res.graph) {
      assert.ok(t.chunkIds.length > 0 && t.chunkIds.every((c) => hitIds.has(c)));
      assert.equal(t.context, "mock: derived from metadata");
      assert.ok(t.source.name && t.target.name && t.relation);
    }
    const r = res.graph.map((t) => `${t.source.name}|${t.relation}|${t.target.name}`);
    assert.ok(r.includes("Synthetic Bank|case_study_of|Synthetic page fx-proof"), r.join("\n"));
  } finally {
    await g.close();
  }
});
