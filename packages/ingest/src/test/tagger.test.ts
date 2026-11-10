import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ChunkMetadataSchema, PLATFORMS, ROOM_SIZES, TOPICS, VENDORS, splitList, type IngestRecord } from "@avispl/shared";
import { PKG_ROOT } from "../paths";
import { buildPageRecords, buildPdfRecords, validateRecord } from "../prepare";
import { SOURCES, validateManifest, type ManifestEntry } from "../sources";
import type { RawScrape } from "../scrape";
import { TAG_FIELDS, TAG_MAX_LENGTH, TAG_VOCAB, detectTags, explainTags, fitTagList, tagInputFromBody, tagRecord, toTagLines } from "../tagger";

// All text below and in fixtures/synthetic is invented for tests. It is not AVI-SPL content.
const LABEL = "SYNTHETIC TEST FIXTURE, NOT AVI-SPL CONTENT";
function fixturePart(name: string): string {
  const txt = readFileSync(join(PKG_ROOT, "fixtures", "synthetic", "tagging-pages.md"), "utf8");
  assert.equal(txt.split("\n")[0]?.trim(), LABEL);
  const part = txt.split(/^=== /m).find((p) => p.startsWith(`${name} ===`));
  assert.ok(part, `fixture part ${name}`);
  return part.slice(part.indexOf("\n") + 1);
}
const src = (over: Partial<ManifestEntry> = {}): ManifestEntry => ({
  id: "synthetic-page", n: 999, title: "Widget Rooms", url: "https://example.com/widget-rooms/",
  stage: "plan_design", contentType: "page", priority: "P0", goldenQueries: ["Q1"], status: "ready", ...over,
});
const raw = (markdown: string, title: string): RawScrape => ({
  id: "synthetic-page", url: "https://example.com/widget-rooms/", requestedAt: "2026-11-10T00:00:00.000Z",
  scrapedAt: "2026-11-10T00:00:01.000Z", attempts: 1, options: {}, markdown, metadata: { title: `${title} | AVI-SPL` },
});
const tags = (body: string, headingPath?: string) => detectTags({ body, headingPath });
const bySection = (recs: IngestRecord[], section: string): IngestRecord => {
  const r = recs.find((x) => x.metadata.section === section);
  assert.ok(r, `record "${section}" not found in: ${recs.map((x) => x.metadata.section).join(" | ")}`);
  return r;
};

// ---------------- alias matching ----------------
test("tagger: platform aliases", () => {
  assert.deepEqual(tags("Invented kit for Teams Rooms.").platforms, ["microsoft"]);
  assert.deepEqual(tags("Certified as an MTR on invented hardware.").platforms, ["microsoft"]);
  assert.deepEqual(tags("Works with Teams, in this invented line.").platforms, ["microsoft"]);
  assert.deepEqual(tags("Join with Webex in one tap.").platforms, ["cisco"]);
  assert.deepEqual(tags("- ###### Webex by Cisco").platforms, ["cisco"]);
  assert.deepEqual(tags("Connect remote people with Google Meet.").platforms, ["google"]);
  assert.deepEqual(tags("Google Workspace is an invented suite.").platforms, ["google"]);
  assert.deepEqual(tags("- ###### Google meet").platforms, ["google"]);
  assert.deepEqual(tags("Invented Zoom Rooms kit.").platforms, ["zoom"]);
  assert.deepEqual(tags("Microsoft Teams, Cisco Webex, Zoom, and Google Meet.").platforms, [...PLATFORMS]);
});

test("tagger: vendor aliases", () => {
  assert.deepEqual(tags("An HP Poly bar.").vendors, ["hp_poly"]);
  assert.deepEqual(tags("A Poly Studio bar.").vendors, ["hp_poly"]);
  assert.deepEqual(tags("- **POLY**").vendors, ["hp_poly"]);
  assert.deepEqual(tags("An older Polycom unit.").vendors, ["hp_poly"]);
  assert.deepEqual(tags("Audio by Q-SYS and QSC.").vendors, ["qsys"]);
  assert.deepEqual(tags("A Neat Bar on the wall.").vendors, ["neat"]);
  assert.deepEqual(tags("Devices from Logitech, Neat, and Crestron.").vendors, ["logitech", "crestron", "neat"]);
  assert.deepEqual(tags("- Neat").vendors, ["neat"]);
  assert.deepEqual(tags("- **SHURE**\n- **LG**\n- Sennheiser\n- Legrand AV").vendors, ["shure", "sennheiser", "lg", "legrand"]);
  assert.deepEqual(tags("A Logi Dock on every desk.").vendors, ["logitech"]);
});

test("tagger: topic aliases", () => {
  const t = (s: string, h?: string) => tags(s, h).topics;
  assert.deepEqual(t("With a Teams Premium license you get Microsoft Places."), ["places", "teams_premium"]);
  assert.deepEqual(t("Copilot in Teams helps."), ["copilot", "ai_features"]);
  assert.deepEqual(t("", "Accessibility and ADA standards"), ["accessibility_ada"]);
  assert.deepEqual(t("AI-Powered Technology"), ["ai_features"]);
  assert.deepEqual(t("Our Real-Time Design approach."), ["real_time_design"]);
  assert.deepEqual(t("Remote monitoring and a 24/7 help desk."), ["monitoring", "support_maintenance"]);
  assert.deepEqual(t("Enterprise Managed Services, bundled as-a-service."), ["managed_services"]);
  assert.deepEqual(t("We plan, deploy, and manage it. Training is included."), ["deployment", "training"]);
  assert.deepEqual(t("Meeting equity for hybrid teams lowers total cost of ownership."), ["meeting_equity", "hybrid_meetings", "roi"]);
  assert.deepEqual(t("Reference designs standardize rooms and are easy to use."), ["ease_of_use", "standardization"]);
  assert.deepEqual(t("Interoperable, secure and sustainable."), ["interoperability", "sustainability", "security"]);
});

test("tagger: room sizes need a room/space noun or a list of bare sizes", () => {
  const r = (s: string, h?: string) => tags(s, h).room_sizes;
  assert.deepEqual(r("- Mobile Collaboration Space\n- Small Meeting Room\n- Medium Meeting Room\n- Large Conference Room\n- Classroom and Training Room"), [...ROOM_SIZES].filter((x) => x !== "huddle"));
  assert.deepEqual(r("For small, medium and large meeting rooms."), ["small", "medium", "large"]);
  assert.deepEqual(r("For small to large rooms."), ["small", "large"]);
  assert.deepEqual(r("Mid-sized rooms and huddle spaces."), ["huddle", "medium"]);
  assert.deepEqual(r("", "Medium Signature Teams Rooms"), ["medium"]);
  assert.deepEqual(r("| Size | Seats |\n|---|---|\n| Small | 4 |\n| Large | 12 |"), ["small", "large"]);
  // no room noun: nothing
  assert.deepEqual(r("A large organization with a small budget and medium risk."), []);
  assert.deepEqual(r("Use the mobile app on a large display."), []);
  assert.deepEqual(r("- Mobile\n- Desktop\n- Web"), []); // one bare size item is not a room list
});

// ---------------- word-boundary safety ----------------
test("tagger: no 'neat' from the adjective or from 'neatly'", () => {
  assert.deepEqual(tags("Cables are neatly routed for a neat finish.").vendors, []);
  assert.deepEqual(tags("Neat cable routing keeps the table clear.").vendors, []); // sentence start, no product word
  assert.deepEqual(tags("", "A Neat Trick for Cables").vendors, []); // title-case heading
  assert.deepEqual(tags("Works with Neat, as tested.").vendors, ["neat"]);
});

test("tagger: 'places' only as the Microsoft product", () => {
  const t = (s: string, h?: string) => tags(s, h).topics.includes("places");
  assert.equal(t("Find quiet places to meet in many places."), false);
  assert.equal(t("Places to meet are listed below."), false); // capital only because of the sentence start
  assert.equal(t("Places can be booked by anyone."), false); // plural verb: plain English
  assert.equal(t("", "Great Places to Work"), false); // title-case heading
  assert.equal(t("Microsoft Places is included."), true);
  assert.equal(t("Integrating Teams Rooms, Copilot, Places, and Surface Hub."), true);
  assert.equal(t("With Teams Premium and Places, people find rooms."), true);
  assert.equal(t("", "Places and Teams Panel Mapping"), true);
  assert.equal(t("Places helps people find a room."), true); // singular verb: the product
});

test("tagger: other ambiguous words stay untagged", () => {
  assert.deepEqual(tags("Our teams work together and zoom in on details.").platforms, []);
  assert.deepEqual(tags("Chat: Teams stay connected.").platforms, []); // people, capital after a colon
  assert.deepEqual(tags("A Pan-Tilt-Zoom camera with 12x Optical Zoom.").platforms, []);
  assert.deepEqual(tags("We are sure the polycarbonate shell and the logical layout fit.").vendors, []);
  assert.deepEqual(tags("Mount two monitors in the classroom and training room.").topics, []); // display, room type
  assert.deepEqual(tags("We support your preferred tools. Deploy the latest ones.").topics, []);
  assert.deepEqual(tags("Private equity firms like easily accessible lobbies.").topics, []);
  assert.deepEqual(tags("Raise the aim of the camera.").topics, []); // "ai" inside a word
});

test("tagger: link targets, image alt text and ancestor headings are not read", () => {
  assert.deepEqual(tags("[Read more](https://example.com/microsoft-teams/logitech/)"), { platforms: [], vendors: [], topics: [], room_sizes: [] });
  assert.deepEqual(tags("![Crestron logo](https://example.com/c.png) Invented text.").vendors, []);
  assert.deepEqual(tags("[![Zoom](https://example.com/z.png)](https://example.com/zoom/)").platforms, []);
  assert.deepEqual(tags("[Cisco](https://example.com/x/) devices.").platforms, ["cisco"]); // the label is body text
  assert.deepEqual(tags("Invented body.", "Real-Time Design with Widgets › Solutions").topics, []);
  assert.deepEqual(tags("Invented body.", "Solutions › Real-Time Design with Widgets").topics, ["real_time_design"]);
  assert.deepEqual(toTagLines("| Small | 4 |").map((l) => l.text), ["Small", "4"]);
  // the page title in the breadcrumb is dropped, the section heading is kept
  assert.deepEqual(tagInputFromBody("Cisco › Solutions\n\nInvented body.", "Cisco"), { headingPath: "Solutions", body: "\nInvented body." });
  assert.ok(explainTags({ body: "Join with Webex." }).cisco?.includes("Webex"));
});

// ---------------- merge rule ----------------
test("merge: identity tags on every section, everything else only when the text supports it", () => {
  const always = { platforms: "microsoft", topics: "monitoring" };
  const a = tagRecord(always, { headingPath: "Widget Tours", body: "Invented text with no product names." });
  assert.deepEqual(a.values, { platforms: "microsoft", vendors: "", topics: "monitoring", room_sizes: "" });
  const b = tagRecord(always, { headingPath: "Widget Partners", body: "Works with Webex and Crestron in small meeting rooms. Copilot too." });
  assert.deepEqual(b.values, { platforms: "microsoft,cisco", vendors: "crestron", topics: "copilot,ai_features,monitoring", room_sizes: "small" });
  assert.deepEqual(b.identity.topics, ["monitoring"]);
  assert.deepEqual(b.detected.platforms, ["microsoft", "cisco"]);
  // no identity, no text support: empty
  assert.deepEqual(tagRecord(undefined, { body: "Invented chairs and tables." }).values, { platforms: "", vendors: "", topics: "", room_sizes: "" });
});

test("merge: only vocab tokens, vocab order, caps respected, tokens never cut", () => {
  const everything = [
    "Microsoft Teams, Cisco Webex, Zoom, Google Meet.",
    "Logitech, Crestron, Neat Bar, HP Poly, Q-SYS, Shure, Sennheiser, LG, Legrand.",
    "Copilot, Microsoft Places, Teams Premium, meeting equity, interoperability, ease of use, AI, sustainability, security,",
    "ADA accessibility, standardization, monitoring, managed services, help desk, deployment, user training,",
    "Real-Time Design, hybrid, ROI.",
    "Mobile carts, huddle rooms, small, medium and large rooms, classrooms.",
  ].join("\n");
  const all = tagRecord(undefined, { body: everything });
  assert.deepEqual(all.detected, { platforms: [...PLATFORMS], vendors: [...VENDORS], topics: [...TOPICS], room_sizes: [...ROOM_SIZES] });
  for (const f of TAG_FIELDS) {
    assert.ok(all.values[f].length <= TAG_MAX_LENGTH[f], `${f} is ${all.values[f].length} chars, max ${TAG_MAX_LENGTH[f]}`);
    assert.deepEqual(splitList(all.values[f]), [...TAG_VOCAB[f]]); // every vocab value fits at once, in vocab order
  }
  assert.deepEqual(TAG_MAX_LENGTH, { platforms: 64, vendors: 256, topics: 256, room_sizes: 128 });
  // forced small cap: whole tokens only, identity kept longest
  assert.equal(fitTagList("topics", TOPICS, [], 30), "copilot,places,teams_premium");
  assert.equal(fitTagList("topics", TOPICS, ["roi", "monitoring"], 30), "copilot,places,monitoring,roi");
  assert.equal(fitTagList("topics", ["roi", "copilot", "not_a_topic"], []), "copilot,roi");
  assert.equal(fitTagList("platforms", PLATFORMS, [], 3), "");
});

// ---------------- manifest ----------------
test("manifest: tag fields live in `always`/`expect`, never in `defaults`; all tokens are vocab", () => {
  assert.deepEqual(validateManifest(SOURCES), []);
  for (const s of SOURCES) for (const f of TAG_FIELDS) assert.ok(!(s.defaults && f in s.defaults), `${s.id}: defaults.${f}`);
  const first = SOURCES[0]!;
  const withDefaults = { ...first, defaults: { topics: "standardization" } } as unknown as ManifestEntry;
  assert.ok(validateManifest([withDefaults, ...SOURCES.slice(1)]).some((p) => /defaults\.topics is not allowed/.test(p)));
  assert.ok(validateManifest([{ ...first, always: { vendors: "poly" } }, ...SOURCES.slice(1)]).some((p) => /"poly" is not in the vocab/.test(p)));
  assert.ok(validateManifest([{ ...first, expect: { topics: "ai" } }, ...SOURCES.slice(1)]).some((p) => /"ai" is not in the vocab/.test(p)));
  const id = (x: string) => SOURCES.find((s) => s.id === x)!;
  assert.deepEqual(id("microsoft-practice").always, { platforms: "microsoft" });
  assert.deepEqual(id("idrc").always, { platforms: "microsoft" });
  assert.deepEqual(id("logitech").always, { vendors: "logitech" });
  assert.deepEqual(id("symphony").always, { topics: "monitoring" });
  assert.equal(id("meeting-rooms").always, undefined);
});

// ---------------- regression: the three observed problems ----------------
test("regression: room-designs page gets platforms on the overview and sizes only on the size list", () => {
  const source = src({ title: "Widget Room Designs", always: { topics: "standardization" }, expect: { room_sizes: "mobile,small,medium,large,classroom" } });
  const recs = buildPageRecords(source, raw(fixturePart("room-designs"), "Widget Room Designs")).records;
  assert.equal(recs.length, 3);
  const overview = bySection(recs, "Overview"), sizes = bySection(recs, "Explore Our Widget Rooms"), other = bySection(recs, "Widget Furniture Notes");
  assert.equal(overview.metadata.platforms, "microsoft,cisco,zoom,google");
  assert.equal(overview.metadata.room_sizes, "");
  assert.equal(sizes.metadata.room_sizes, "mobile,small,medium,large,classroom");
  assert.equal(sizes.metadata.platforms, "");
  assert.equal(other.metadata.platforms, "");
  assert.equal(other.metadata.room_sizes, "");
  for (const r of recs) assert.ok(splitList(r.metadata.topics).includes("standardization")); // identity tag on every section
  assert.ok(!splitList(sizes.metadata.topics).includes("training")); // "Training Room" is a room type
});

test("regression: meeting page gets platforms where they are named and topics per section", () => {
  const recs = buildPageRecords(src({ title: "Widget Meetings", expect: { topics: "meeting_equity,interoperability" } }), raw(fixturePart("meeting-page"), "Widget Meetings")).records;
  const intro = bySection(recs, "Widget Meetings That Work"), pref = bySection(recs, "We Support Your Preferred Widget Solutions"), cat = bySection(recs, "Widget Catalog");
  assert.equal(pref.metadata.platforms, "microsoft,cisco,zoom,google");
  assert.equal(pref.metadata.topics, "copilot,places,ai_features");
  assert.equal(intro.metadata.platforms, "");
  assert.equal(intro.metadata.topics, "interoperability,ease_of_use,security,hybrid_meetings");
  assert.equal(cat.metadata.platforms, "");
  assert.equal(cat.metadata.topics, ""); // `expect` is report-only, never copied
  assert.notEqual(intro.metadata.topics, pref.metadata.topics);
});

test("regression: Microsoft page keeps the platform everywhere, licensed-feature topics only where mentioned", () => {
  const source = src({ title: "Widget Platform Practice", stage: "choose_platform", always: { platforms: "microsoft" }, expect: { topics: "copilot,places,teams_premium" }, defaults: { requires_disclosure: true } });
  const recs = buildPageRecords(source, raw(fixturePart("platform-page"), "Widget Platform Practice")).records;
  const practice = bySection(recs, "Our Widget Practice"), tours = bySection(recs, "Widget Tours"), partners = bySection(recs, "Widget Partners");
  assert.equal(practice.metadata.topics, "copilot,places,teams_premium,ai_features");
  assert.equal(tours.metadata.topics, "");
  assert.equal(tours.metadata.platforms, "microsoft"); // identity
  assert.equal(partners.metadata.platforms, "microsoft,cisco");
  assert.equal(partners.metadata.vendors, "logitech,crestron,neat,hp_poly,qsys");
  assert.equal(partners.metadata.topics, "interoperability");
  // The licensing flag is per record too: only sections naming Copilot / Places / Teams Premium carry it.
  assert.equal(practice.metadata.requires_disclosure, true);
  assert.equal(tours.metadata.requires_disclosure, false);
  assert.equal(partners.metadata.requires_disclosure, false);
  for (const r of recs) {
    assert.equal(r.metadata.journey_stage, "choose_platform");
    validateRecord(r);
    ChunkMetadataSchema.strict().parse(r.metadata);
  }
});

// ---------------- approvals must survive ----------------
test("tags never change record ids, bodies or content hashes; only the four tag fields differ", () => {
  const md = fixturePart("platform-page");
  const plain = buildPageRecords(src({ title: "Widget Platform Practice" }), raw(md, "Widget Platform Practice")).records;
  const tagged = buildPageRecords(
    src({ title: "Widget Platform Practice", always: { platforms: "zoom", vendors: "lg", topics: "roi", room_sizes: "huddle" }, expect: { topics: "copilot" } }),
    raw(md, "Widget Platform Practice"),
  ).records;
  assert.equal(plain.length, tagged.length);
  plain.forEach((p, i) => {
    const t = tagged[i]!;
    assert.equal(t.id, p.id);
    assert.equal(t.body, p.body);
    assert.equal(t.additional.contentHash, p.additional.contentHash);
    const strip = (r: IngestRecord) => Object.fromEntries(Object.entries(r.metadata).filter(([k]) => !(TAG_FIELDS as readonly string[]).includes(k)));
    assert.deepEqual(strip(t), strip(p));
    assert.ok(splitList(t.metadata.platforms).includes("zoom") && splitList(t.metadata.room_sizes).includes("huddle"));
    assert.ok(!JSON.stringify(t).includes("expect") && !JSON.stringify(t).includes('"always"'));
  });
});

test("pdf records are tagged from their own page-range text", () => {
  const source = src({ id: "synthetic-pdf", title: "Widget Catalog", contentType: "pdf", always: { topics: "standardization" } });
  const recs = buildPdfRecords(source, {
    sourceId: "synthetic-pdf", url: "https://example.com/widget.pdf", edition: "2099", file: "widget.pdf", totalPages: 4, extractedAt: "2026-11-10T00:00:00.000Z",
    sections: [
      { page_range: "1-2", title: "Small rooms", text: "Invented page text about a small meeting room with a Logitech bar for Zoom Rooms.", words: 14 },
      { page_range: "3-4", title: "Cabling", text: "Invented page text about cable trays only.", words: 7 },
    ],
  } as never);
  assert.deepEqual([recs[0]!.metadata.platforms, recs[0]!.metadata.vendors, recs[0]!.metadata.room_sizes, recs[0]!.metadata.topics], ["zoom", "logitech", "small", "standardization"]);
  assert.deepEqual([recs[1]!.metadata.platforms, recs[1]!.metadata.vendors, recs[1]!.metadata.room_sizes, recs[1]!.metadata.topics], ["", "", "", "standardization"]);
});

// ---------------- manifest numbering, PDF page ranges ----------------
test("manifest: sources added after the brief take n > 60 and never disturb 1..60", async () => {
  const { BRIEF_SOURCE_COUNT, isBriefSource } = await import("../sources");
  assert.equal(SOURCES.filter(isBriefSource).length, BRIEF_SOURCE_COUNT);
  const added = SOURCES.filter((s) => s.addedAfterBrief);
  assert.deepEqual(added.map((s) => [s.id, s.n]), [["standardization-guide-blog", 62], ["teams-rooms-faq", 63]]);
  const first = SOURCES[0]!;
  const extra = (over: Partial<ManifestEntry>): ManifestEntry => ({ ...first, id: "synthetic-extra", url: "https://avispl.com/synthetic-extra/", ...over });
  assert.ok(validateManifest([...SOURCES, extra({ n: 64 })]).some((p) => /needs `addedAfterBrief`/.test(p)));
  assert.ok(validateManifest([...SOURCES, extra({ n: 63, addedAfterBrief: "test" })]).some((p) => /duplicate source number/.test(p)));
  assert.ok(validateManifest([...SOURCES, extra({ n: 13, addedAfterBrief: "test" })]).some((p) => /must use n > 60/.test(p)));
  assert.deepEqual(validateManifest([...SOURCES, extra({ n: 64, addedAfterBrief: "test" })]), []);
  // the two PDF URLs resolved from scraped pages are complete, and no resolved source keeps a truncated URL
  for (const id of ["concept-catalog-2025-winter", "lg-express-teams-room-pdf"]) {
    const s = SOURCES.find((x) => x.id === id)!;
    assert.ok(s.url?.endsWith(".pdf") && !s.url.includes("…") && !s.truncatedUrl);
    assert.match(s.note ?? "", /read verbatim/);
  }
});

test("pdf: running header/footer lines are stripped, short documents keep everything", async () => {
  const { findRunningLines, stripRunningLines } = await import("../pdf");
  const pages = Array.from({ length: 8 }, (_, i) => `${i + 1} | WIDGET CATALOG call 555-0100\nInvented body about widget ${"abcdefgh"[i]}.\n${i + 1}`);
  const running = findRunningLines(pages);
  assert.equal(stripRunningLines(pages[2]!, running), "Invented body about widget c."); // header and bare page number gone
  const two = ["contact line\nInvented page one.", "contact line\nInvented page two."];
  assert.equal(findRunningLines(two).size, 0);
});

test("pdf: a page range can override stage and industry; ids come from url + page range", () => {
  const source = src({ id: "synthetic-pdf", title: "Widget Catalog", contentType: "pdf", stage: "plan_design" });
  const recs = buildPdfRecords(source, {
    sourceId: "synthetic-pdf", url: "https://example.com/widget.pdf", edition: "2099", file: "widget.pdf", totalPages: 9, extractedAt: "2026-11-10T00:00:00.000Z",
    sections: [
      { page_range: "1-2", title: "Planning", text: "Invented planning text.", words: 3 },
      { page_range: "5-7", title: "Invented Bank case study", text: "Invented case study text.", words: 4, stage: "proof", industry: "financial_services" },
    ],
  });
  assert.deepEqual(recs.map((r) => [r.metadata.journey_stage, r.metadata.industry, r.metadata.page_range, r.metadata.edition]), [
    ["plan_design", "general", "1-2", "2099"], ["proof", "financial_services", "5-7", "2099"],
  ]);
  assert.notEqual(recs[0]!.id, recs[1]!.id);
  for (const r of recs) { assert.equal(r.url, "https://example.com/widget.pdf"); assert.equal(r.metadata.status, "needs_review"); validateRecord(r); }
});
