import { test } from "node:test";
import assert from "node:assert/strict";
import { ChunkMetadataSchema } from "@avispl/shared";
import { FIXTURE_MARK, FIXTURES } from "./knowledge/fixtures";
import { MockKnowledgeStore } from "./knowledge/mock-store";
import { RefRegistry } from "./refs";
import { runFindCaseStudies, runSearchJourney, searchJourneyInput } from "./tool-logic";

const store = new MockKnowledgeStore();
const BLOCKED = new Set(["fx-offscope-videowall#overview", "fx-unpublished#draft"]);

test("fixtures are valid metadata, clearly synthetic, and never on avispl.com", () => {
  for (const f of FIXTURES) {
    ChunkMetadataSchema.parse(f.metadata);
    assert.ok(f.text.startsWith(FIXTURE_MARK), f.chunkId);
    assert.ok(!/avispl\.com/.test(f.metadata.source_url), f.chunkId);
  }
});

test("hard filters cannot be removed by the model", async () => {
  const sneaky = {
    query: "monitoring Copilot Places standardization video walls draft",
    status: "needs_review",
    meeting_room_relevant: false,
    filters: { status: "needs_review" },
  };
  const parsed = searchJourneyInput.parse(sneaky) as Record<string, unknown>;
  assert.ok(!("status" in parsed) && !("meeting_room_relevant" in parsed) && !("filters" in parsed));
  const out = await runSearchJourney(store, new RefRegistry(), sneaky);
  assert.ok(out.hits.length > 0);
  for (const h of out.hits) assert.ok(!BLOCKED.has(h.chunkId), `blocked chunk returned: ${h.chunkId}`);
  assert.equal(out.appliedFilters.status, "published");
  assert.equal(out.appliedFilters.meeting_room_relevant, true);
});

test("model filters are honoured", async () => {
  const out = await runSearchJourney(store, new RefRegistry(), { query: "monitoring support escalation", journey_stage: "run_support" });
  assert.ok(out.hits.length > 0);
  assert.ok(out.hits.every((h) => h.journeyStage === "run_support"));
  assert.equal(out.relaxed, false);
});

test("relaxed is surfaced when filters match nothing", async () => {
  const out = await runSearchJourney(store, new RefRegistry(), {
    query: "remote participants meeting equity",
    industry: "nonprofit",
    vendors: ["shure"],
  });
  assert.equal(out.relaxed, true);
  assert.ok(out.hits.length > 0);
  assert.match(out.note ?? "", /retried with only the mandatory filters/);
  assert.equal(out.appliedFilters.industry, undefined);
});

test("off-topic query returns nothing and says so", async () => {
  const out = await runSearchJourney(store, new RefRegistry(), { query: "aquarium tank lighting" });
  assert.equal(out.hits.length, 0);
  assert.equal(out.graph.length, 0);
  assert.match(out.note ?? "", /Nothing relevant/);
});

test("refs are stable across calls in one conversation and seeded from history", async () => {
  const reg = new RefRegistry();
  const a = await runSearchJourney(store, reg, { query: "small medium large room standardization" });
  const b = await runSearchJourney(store, reg, { query: "standardization repeatable model rollout" });
  const refA = new Map(a.hits.map((h) => [h.chunkId, h.ref]));
  for (const h of b.hits) if (refA.has(h.chunkId)) assert.equal(h.ref, refA.get(h.chunkId));
  const all = [...a.hits, ...b.hits];
  const byRef = new Map<string, string>();
  for (const h of all) {
    const prev = byRef.get(h.ref);
    assert.ok(!prev || prev === h.chunkId, `ref ${h.ref} reused for two chunks`);
    byRef.set(h.ref, h.chunkId);
  }
  // A new request seeded from the UI history keeps the same numbering.
  const history = [{ parts: [{ type: "tool-searchJourney", state: "output-available", output: a }] }];
  const reg2 = new RefRegistry().seedFromMessages(history);
  const c = await runSearchJourney(store, reg2, { query: "small medium large room standardization" });
  assert.deepEqual(c.hits.map((h) => h.ref), a.hits.map((h) => h.ref));
  const fresh = await runSearchJourney(store, reg2, { query: "monitoring escalation support" });
  const maxA = Math.max(...a.hits.map((h) => Number(h.ref.slice(1))));
  for (const h of fresh.hits) if (!refA.has(h.chunkId)) assert.ok(Number(h.ref.slice(1)) > maxA);
});

test("graph triplets only reference returned chunks", async () => {
  const out = await runSearchJourney(store, new RefRegistry(), { query: "monitoring escalation support managed services" });
  assert.ok(out.graph.length > 0);
  const ids = new Set(out.hits.map((h) => h.chunkId));
  for (const t of out.graph) assert.ok(t.chunkIds.length > 0 && t.chunkIds.every((c) => ids.has(c)));
});

test("findCaseStudies: proof/case_study only, rooms desc, legacy last", async () => {
  const out = await runFindCaseStudies(store, new RefRegistry(), { platform: "microsoft" });
  assert.ok(out.hits.length >= 3);
  assert.ok(out.hits.every((h) => h.journeyStage === "proof" && h.contentType === "case_study"));
  const legacyIdx = out.hits.findIndex((h) => h.flags.legacyPlatform);
  assert.equal(legacyIdx, out.hits.length - 1, "legacy case study must be last even with the most rooms");
  const nonLegacy = out.hits.filter((h) => !h.flags.legacyPlatform).map((h) => h.csRoomsCount ?? 0);
  assert.deepEqual(nonLegacy, [...nonLegacy].sort((x, y) => y - x));
  assert.ok(out.hits.find((h) => h.flags.legacyPlatform)?.cautions.some((c) => /older platform/.test(c)));
  assert.ok(out.hits.find((h) => h.flags.metricsAreEstimates)?.cautions.some((c) => /estimates/.test(c)));
});

test("findCaseStudies keeps its restriction even when the store relaxes", async () => {
  const out = await runFindCaseStudies(store, new RefRegistry(), { industry: "legal", topic: "copilot" });
  assert.equal(out.relaxed, true);
  assert.ok(out.hits.every((h) => h.journeyStage === "proof" && h.contentType === "case_study"));
  assert.equal(out.appliedFilters.journey_stage, "proof");
});

test("a throwing store becomes an 'unavailable' result through the AI SDK tool wrapper", async () => {
  const { createTools } = await import("./tools");
  const broken = { name: "hydra", search: async () => { throw new Error("HYDRADB_API_KEY is not set"); } };
  const tools = createTools(broken, new RefRegistry());
  const out = await tools.searchJourney.execute({ query: "monitoring" }, { toolCallId: "t", messages: [] } as never);
  assert.equal((out as { unavailable?: boolean }).unavailable, true);
  assert.equal((out as { hits: unknown[] }).hits.length, 0);
});
