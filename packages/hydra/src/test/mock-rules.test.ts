import { test } from "node:test";
import assert from "node:assert/strict";
import { MockEngine, splitChunks } from "../mock-server/engine";
import { createSearchIndex } from "../mock-server/search-index";
import { toWireSchema } from "../schema";

const form = (o: Record<string, string>) => new Map<string, string | { file: true }>(Object.entries(o));
const body = (r: { body: unknown }) => r.body as any;

for (const kind of ["fts5", "bm25"] as const) {
  test(`search index (${kind}): keyword match, ranking, allowed-set filtering`, () => {
    const idx = createSearchIndex(kind);
    assert.equal(idx.kind, kind);
    idx.add("a", "alpha beta gamma");
    idx.add("b", "alpha alpha alpha");
    idx.add("c", "delta");
    const r = idx.search("alpha", 10, () => true);
    assert.deepEqual(r.map((x) => x.uuid).sort(), ["a", "b"]);
    assert.ok(r[0]!.score <= 1 && r[0]!.score > 0);
    assert.deepEqual(idx.search("alpha", 10, (u) => u === "a").map((x) => x.uuid), ["a"]);
    idx.remove("a");
    assert.deepEqual(idx.search("alpha", 10, () => true).map((x) => x.uuid), ["b"]);
    assert.deepEqual(idx.search("   ", 10, () => true), []);
  });
}

test("engine: create-database rules mirror the docs", () => {
  const e = new MockEngine({ readyAfterMs: 0, stepMs: 0 });
  assert.equal(e.createDatabase({ database: "Bad Name" }).status, 400);
  assert.equal(e.createDatabase({ database: "x", database_metadata_schema: [{ name: "a", data_type: "ARRAY" }] }).status, 400);
  assert.equal(e.createDatabase({ database: "x", database_metadata_schema: [{ name: "a", data_type: "BOOL", enable_dense_embedding: true }] }).status, 400);
  const seven = Array.from({ length: 4 }, (_, i) => ({ name: `f${i}`, data_type: "VARCHAR", enable_dense_embedding: true, enable_sparse_embedding: true }));
  assert.equal(e.createDatabase({ database: "x", database_metadata_schema: seven }).status, 400);
  assert.equal(e.createDatabase({ database: "x", database_metadata_schema: [{ name: "a", purpose: "note" }] }).status, 400, "purpose must never be sent");
  assert.equal(e.createDatabase({ database: "x", database_metadata_schema: [{ name: "source_url", data_type: "VARCHAR", max_length: 512 }] }).status, 400, "source_url is reserved (real API, probe 2026-11-10)");
  assert.equal(e.createDatabase({ database: "x", database_metadata_schema: toWireSchema() }).status, 200);
  assert.equal(e.createDatabase({ database: "x", database_metadata_schema: toWireSchema() }).status, 409);
});

test("engine: contains is comma-member (token) match, equals is whole value, bare forms, null -> 400", () => {
  const e = new MockEngine({ readyAfterMs: 0, stepMs: 0, search: "bm25" });
  e.createDatabase({ database: "d", database_metadata_schema: [{ name: "topics", data_type: "VARCHAR" }, { name: "flag", data_type: "BOOL" }] });
  const items = [
    { id: "1", kind: "knowledge_base", fields: { kind: "knowledge_base", title: "t", body: "word one" }, metadata: { topics: "meeting_equity,roi", flag: true } },
    { id: "2", kind: "knowledge_base", fields: { kind: "knowledge_base", title: "t", body: "word two" }, metadata: { topics: "roi", flag: false } },
  ];
  assert.equal(e.ingest(form({ database: "d", type: "knowledge", app_knowledge: JSON.stringify(items) })).status, 202);
  const q = (f: unknown) => {
    const r = e.query({ database: "d", query: "word", metadata_filters: f });
    return r.status === 200 ? body(r).data.chunks.map((c: any) => c.id).sort() : r.status;
  };
  assert.deepEqual(q({ topics: { contains: "roi" } }), ["1", "2"]);
  assert.deepEqual(q({ topics: { contains: "equity" } }), [], "no substring matching");
  assert.deepEqual(q({ topics: { equals: "roi" } }), ["2"]);
  assert.deepEqual(q({ topics: { contains_any: ["meeting_equity", "x"] } }), ["1"]);
  assert.deepEqual(q({ topics: "roi" }), ["2"], "bare scalar = equals");
  assert.deepEqual(q({ topics: ["roi"] }), ["1", "2"], "one-element array = contains");
  assert.deepEqual(q({ flag: { equals: false } }), ["2"]);
  assert.deepEqual(q({ topics: { contian: "roi" } }), [], "misspelled operator matches nothing");
  assert.equal(q({ topics: null }), 400);
  assert.equal(q({ flag: { equals: "false" } }), 400, "type mismatch");
  assert.equal(q({ flag: { contains: "x" } }), 400, "contains on non-VARCHAR");
  assert.equal(e.query({ database: "d", query: "" }).status, 400);
  assert.equal(e.query({ database: "d", query: "x", operator: "and" }).status, 400);
  assert.equal(e.query({ database: "d", query: "x", max_results: 251 }).status, 400);
  assert.equal(body(e.query({ database: "d", query: "word" })).meta.mock, true);
  assert.equal(typeof body(e.query({ database: "d", query: "word" })).data.llm_prompt, "string");
});

test("engine: ingest rejects unknown item fields, documents, commas, null metadata", () => {
  const e = new MockEngine({ readyAfterMs: 0, stepMs: 0 });
  e.createDatabase({ database: "d", database_metadata_schema: [{ name: "topics", data_type: "VARCHAR", max_length: 4 }] });
  const it = { id: "1", kind: "knowledge_base", fields: { kind: "knowledge_base", title: "t", body: "b" } };
  const send = (x: unknown) => e.ingest(form({ database: "d", app_knowledge: JSON.stringify([x]) })).status;
  assert.equal(send({ ...it, golden_queries: ["Q1"] }), 400);
  assert.equal(send({ ...it, id: "a,b" }), 400);
  assert.equal(send({ ...it, metadata: { topics: null } }), 400);
  assert.equal(send({ ...it, metadata: { topics: "toolong" } }), 400, "max_length in bytes");
  assert.equal(send({ ...it, metadata: { topics: ["a"] } }), 400, "arrays rejected on VARCHAR");
  assert.equal(e.ingest(form({ database: "d", document_metadata: "[]" })).status, 400);
  assert.equal(e.ingest(form({ database: "nope", app_knowledge: "[]" })).status, 404);
  assert.equal(send(it), 202);
});

test("engine: splitChunks is deterministic", () => {
  assert.deepEqual(splitChunks("a\n\nb", 120), ["a\n\nb"]);
  const long = Array.from({ length: 3 }, (_, i) => Array(100).fill(`w${i}`).join(" ")).join("\n\n");
  assert.equal(splitChunks(long, 120).length, 3);
});

test("engine: MOCK_GRAPH=metadata builds v2-shaped triplets from metadata of returned chunks only", () => {
  const mk = (graph: "none" | "metadata") => {
    const e = new MockEngine({ readyAfterMs: 0, stepMs: 0, graph });
    e.createDatabase({ database: "d", database_metadata_schema: toWireSchema() });
    const md = (o: Record<string, unknown>) => ({
      journey_stage: "proof", content_type: "case_study", platforms: "microsoft,cisco", vendors: "neat", topics: "roi", room_sizes: "",
      industry: "general", status: "published", meeting_room_relevant: true, requires_disclosure: false, legacy_platform: false,
      metrics_are_estimates: false, edition: "", page_url: "https://x.example/a", page_title: "Case A", section: "s", page_range: "",
      last_modified: "", cs_organization: "Org A", cs_location: "Town", cs_rooms_count: 3, last_crawled: "", ...o,
    });
    const items = [
      { id: "a", kind: "knowledge_base", fields: { kind: "knowledge_base", title: "A", body: "kiwi alpha" }, metadata: md({}) },
      { id: "b", kind: "knowledge_base", fields: { kind: "knowledge_base", title: "B", body: "other words" }, metadata: md({ page_title: "Page B", cs_organization: "" }) },
    ];
    e.ingest(form({ database: "d", app_knowledge: JSON.stringify(items) }));
    return e;
  };
  const r = body(mk("metadata").query({ database: "d", query: "kiwi", mode: "thinking" }));
  const chunkIds = new Set(r.data.chunks.map((c: any) => c.chunk_uuid));
  assert.deepEqual([...chunkIds], ["a_chunk_0"]);
  const paths = r.data.graph_context.query_paths;
  assert.equal(paths.length, 1);
  assert.deepEqual(paths[0].source_chunk_ids, ["a_chunk_0"]);
  const ts = paths[0].triplets;
  const spo = ts.map((t: any) => `${t.source.name}|${t.relation.canonical_predicate}|${t.target.name}`);
  assert.deepEqual(spo, [
    "Case A|covers_stage|proof", "Case A|mentions_platform|microsoft", "Case A|mentions_platform|cisco",
    "Case A|mentions_vendor|neat", "Case A|covers_topic|roi", "Org A|case_study_of|Case A", "Org A|located_in|Town",
  ]);
  for (const t of ts) {
    assert.ok(chunkIds.has(t.relation.chunk_id));
    assert.equal(t.relation.context, "mock: derived from metadata");
    assert.equal(typeof t.source.type, "string");
    assert.equal(typeof t.target.type, "string");
    assert.ok(!/deploy/i.test(t.relation.canonical_predicate));
  }
  assert.ok(!spo.some((x: string) => x.includes("Page B")), "only chunks in the result set");
  assert.equal(r.meta.mock, true);
  assert.deepEqual(body(mk("none").query({ database: "d", query: "kiwi", mode: "thinking" })).data.graph_context.query_paths, []);
});
