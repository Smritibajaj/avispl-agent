import { test } from "node:test";
import assert from "node:assert/strict";
import { ChunkMetadataSchema, EMPTY_METADATA_DEFAULTS, PLATFORMS, ROOM_SIZES, TOPICS, VENDORS, type IngestRecord } from "@avispl/shared";
import { BriefSchema, buildBriefRecord, checkBrief, numberTokens, unknownNames, verbatimRuns, type Brief } from "../knowledge";

// SYNTHETIC TEST FIXTURE, NOT AVI-SPL CONTENT
const section = (id: string, body: string, over: Partial<IngestRecord["metadata"]> = {}): IngestRecord => ({
  id,
  sourceId: "synthetic-page",
  title: "Widget Rooms › Monitoring",
  url: "https://example.com/widget-rooms/",
  body,
  metadata: ChunkMetadataSchema.parse({
    ...EMPTY_METADATA_DEFAULTS,
    status: "published",
    journey_stage: "run_support",
    content_type: "page",
    source_url: "https://example.com/widget-rooms/",
    page_title: "Widget Rooms",
    section: "Monitoring",
    last_crawled: "2026-11-10",
    ...over,
  }),
  additional: { contentHash: "x" },
  relationIds: [],
  timestamp: "2026-09-01T00:00:00+00:00",
});

const A = section(
  "a",
  "Widget Rooms › Monitoring\n\nFjordlantern watches 1,200 rooms 24/7 from two operations centres. Faults are logged within 15 minutes and the Brightpanel console shows room health.",
  { topics: "monitoring", platforms: "zoom" },
);
const B = section("b", "Widget Rooms › Reports\n\nA monthly report lists the ten rooms with the most faults.", { topics: "roi,monitoring", platforms: "microsoft" });

const filler =
  "The service covers the estate around the clock and gives the support team one place to see which rooms need attention. " +
  "Faults are recorded quickly so that the team can act before a meeting is affected, and the console presents the health of each room. " +
  "A report each month points to the rooms that fail most often, which helps a team decide where to spend effort first. " +
  "Use this when a customer asks how rooms are watched after installation and what reporting they would receive from the provider.";
const brief = (body: string, over: Partial<Brief> = {}): Brief =>
  BriefSchema.parse({ sourceId: "synthetic-page", stage: "run_support", slug: "monitoring", section: "Widget Rooms monitoring and reporting", body, basedOn: ["a", "b"], ...over });

test("numberTokens keeps numbers as written", () => {
  assert.deepEqual(numberTokens("1,200 rooms, 24/7, 99.9% and 15 minutes. In 2025."), ["1,200", "24/7", "99.9", "15", "2025"]);
});

test("a faithful brief passes, including a spelled-out number written as a digit", () => {
  const r = checkBrief(brief(`Fjordlantern watches 1,200 rooms 24/7 from 2 operations centres and logs faults within 15 minutes. ${filler}`), [A, B]);
  assert.deepEqual(r.errors, []);
});

test("an invented number is an error", () => {
  const r = checkBrief(brief(`Fjordlantern watches 1,500 rooms and resolves 95% of faults. ${filler}`), [A, B]);
  assert.match(r.errors.join("\n"), /numbers not in the source sections: 1,500, 95/);
});

test("copied text and unknown names are warnings", () => {
  assert.equal(verbatimRuns("x faults are logged within 15 minutes and the brightpanel console shows room health y", A.body).length, 1);
  assert.deepEqual(unknownNames("The service uses the Brightpanel console and the Glimmerdesk portal.", A.body), ["Glimmerdesk"]);
});

test("sections of another source or unpublished sections are errors", () => {
  const other = { ...B, sourceId: "other-page" };
  assert.match(checkBrief(brief(filler + " " + filler), [A, other]).errors.join("\n"), /belongs to other-page/);
  const hidden = section("c", "text", { status: "needs_review" });
  assert.match(checkBrief(brief(filler + " " + filler), [A, hidden]).errors.join("\n"), /not published/);
});

test("the record carries the union of tags, the page URL and links to its sections", () => {
  const rec = buildBriefRecord(brief(filler + " " + filler), [A, B], { platforms: PLATFORMS, vendors: VENDORS, topics: TOPICS, roomSizes: ROOM_SIZES });
  assert.equal(rec.metadata.platforms, "microsoft,zoom");
  assert.equal(rec.metadata.topics, "monitoring,roi");
  assert.equal(rec.metadata.status, "published");
  assert.equal(rec.url, A.url);
  assert.deepEqual(rec.relationIds, ["a", "b"]);
  assert.ok(rec.body.startsWith("Widget Rooms › Widget Rooms monitoring and reporting\n\n"));
  assert.notEqual(rec.id, A.id);
});
