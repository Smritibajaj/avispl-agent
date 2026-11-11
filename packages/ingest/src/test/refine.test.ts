// SYNTHETIC TEST FIXTURE, NOT AVI-SPL CONTENT (every string below is invented for the tests).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { IngestRecord } from "@avispl/shared";
import { classifyChrome, cleanMarkdown, cleanPdfPageText, dropRepeatedRuns, repairMarkup } from "../clean";
import { chunkSections, clipName, isQuestionBlock, joinNames, parseSections, splitBalanced, type SplitEvent } from "../split";
import { buildPageRecords, buildPdfRecords, dropDuplicates, pdfPageGroups, splitPdfPage } from "../prepare";
import { detectIndustry, detectRoomSizes, detectStage, detectTags, toTagLines } from "../tagger";
import type { ManifestEntry } from "../sources";
import type { RawScrape } from "../scrape";

const words = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `${tag}${i}`).join(" ");
const sentence = (n: number, tag: string) => `${words(n, tag)}.`;
const src = (over: Partial<ManifestEntry> = {}): ManifestEntry => ({
  id: "synthetic-page", n: 999, title: "Widget Rooms", url: "https://example.com/widget-rooms/",
  stage: "plan_design", contentType: "page", priority: "P0", goldenQueries: [], status: "ready", ...over,
});
const raw = (markdown: string): RawScrape => ({
  id: "synthetic-page", url: "https://example.com/widget-rooms/", requestedAt: "2026-11-10T00:00:00.000Z",
  scrapedAt: "2026-11-10T00:00:01.000Z", attempts: 1, options: {}, markdown, metadata: { title: "Widget Rooms | AVI-SPL" },
});
const chunk = (md: string, events: SplitEvent[] = []) =>
  chunkSections(parseSections(md, "Widget Rooms", { defaultStage: "plan_design" }), "Widget Rooms", { events });

// ---------------- cleaning ----------------
test("clean: player fallback, share buttons, blog prev/next, anchor menus and related posts are chrome", () => {
  assert.equal(classifyChrome("Your browser does not support the video tag."), "media_fallback");
  assert.equal(classifyChrome("[Share by Email](mailto:?subject=x) [Share on LinkedIn](https://example.com/s)"), "share_links");
  assert.equal(classifyChrome("[Back to Blog](https://example.com/blog/) [Next Article](https://example.com/blog/n/)"), "blog_nav");
  assert.equal(classifyChrome("- [Explore Alpha](https://example.com/p/#alpha)\n- [Explore Beta](https://example.com/p/#beta)\n- [Explore Gamma](https://example.com/p/#gamma)"), "anchor_nav");
  // a list of offerings with real targets is content
  assert.equal(classifyChrome("- [Widget A](https://example.com/a/)\n- [Widget B](https://example.com/b/)\n- [Widget C](https://example.com/c/)"), null);
  assert.equal(classifyChrome("Read our [guide](https://example.com/g/) to invented widgets before you plan."), null);

  const md = [
    "# Widget post", "## Real section", sentence(20, "real"),
    "#### You may also like", "Oct 8, 2026", "[Invented tag](https://example.com/t/)", "[Invented teaser title](https://example.com/b/)",
    "## After", sentence(20, "after"),
    "##### Partners", "We partner with invented providers.",
  ].join("\n\n");
  const out = cleanMarkdown(md);
  assert.doesNotMatch(out.markdown, /You may also like|Invented teaser|Partners|invented providers/);
  assert.match(out.markdown, /real0/);
  assert.match(out.markdown, /after0/);
  assert.ok(out.removed.some((r) => r.kind === "related_posts") && out.removed.some((r) => r.kind === "logo_caption"));
});

test("clean: markup repairs change no words", () => {
  assert.equal(repairMarkup("[\\\\\n**Invented Room**](https://example.com/r)"), "[Invented Room](https://example.com/r)");
  assert.equal(repairMarkup("**W** hat does the widget do?"), "What does the widget do?");
  assert.equal(repairMarkup("**Bold** words stay bold."), "**Bold** words stay bold.");
});

test("pdf: page text loses markers, figure numbers, >CTA lines and a repeated pull quote, nothing else", () => {
  const quote = "the invented agent can resolve widget challenges to improve widget satisfaction for everyone";
  const page = [
    "<!-- page 7 -->", "Invented heading", `Body text says ${quote} today.`.replace(" today.", "\ntoday and tomorrow."),
    "The invented agent can resolve widget", "challenges to improve widget satisfaction", "for everyone", "More body text follows here.", ">Watch the webcast", "1 2",
  ].join("\n");
  const out = cleanPdfPageText(page);
  assert.doesNotMatch(out, /page 7|Watch the webcast|^1 2$/m);
  assert.equal(out.match(/challenges to improve/g)?.length, 1);
  assert.match(out, /More body text follows here\./);
  // a short repeat is not a pull quote
  assert.deepEqual(dropRepeatedRuns(["Invented widgets are good.", "Invented widgets", "are fine."]), ["Invented widgets are good.", "Invented widgets", "are fine."]);
});

test("pdf: one record per page with the page as page_range; tiny pages join a neighbour; long pages split at a heading line", () => {
  const text = `<!-- page 5 -->\nTITLE PAGE\n<!-- page 6 -->\n${sentence(100, "six")}\n<!-- page 7 -->\n${sentence(90, "seven")}`;
  assert.deepEqual(pdfPageGroups(text, "5-7").map((g) => [g.from, g.to]), [[5, 6], [7, 7]]);
  const recs = buildPdfRecords(src({ id: "synthetic-pdf", title: "Widget Catalog", contentType: "pdf" }), {
    sourceId: "synthetic-pdf", url: "https://example.com/widget.pdf", edition: "2099", file: "widget.pdf", totalPages: 9, extractedAt: "2026-11-10T00:00:00.000Z",
    sections: [{ page_range: "5-7", title: "Invented article", text, words: 200 }],
  });
  assert.deepEqual(recs.map((r) => [r.metadata.page_range, r.metadata.section]), [["5-6", "Invented article (pp. 5-6)"], ["7", "Invented article (p. 7)"]]);
  assert.equal(new Set(recs.map((r) => r.id)).size, 2);
  assert.doesNotMatch(recs[0]!.body, /<!--/);

  const long = [sentence(30, "a"), sentence(30, "b"), sentence(30, "c"), sentence(30, "d"), sentence(30, "e"), sentence(30, "f"), "Invented Second Topic", sentence(30, "g"), sentence(30, "h"), sentence(30, "i"), sentence(30, "j"), sentence(30, "k"), sentence(30, "l"), sentence(30, "m")].join("\n");
  const parts = splitPdfPage(long);
  assert.equal(parts.length, 2);
  assert.match(parts[1]!, /^Invented Second Topic/);
  assert.equal(parts.join("\n"), long); // nothing lost, nothing added
  assert.deepEqual(splitPdfPage(sentence(100, "short")), [sentence(100, "short")]);
});

// ---------------- one topic per record ----------------
test("split: the record's own heading is not repeated in the body; sub-headings of merged sections stay", () => {
  const c = chunk(["# Widget Rooms", "## Alpha", sentence(30, "a"), "## Beta", sentence(30, "b")].join("\n\n"));
  assert.deepEqual(c.map((x) => x.section), ["Alpha", "Beta"]);
  assert.doesNotMatch(c[0]!.body, /Alpha/);
  assert.match(c[0]!.body, /^a0 /);
});

test("split: a short untitled intro joins the first section; a family of short cards is one record", () => {
  const events: SplitEvent[] = [];
  const md = [
    "# Widget Rooms", sentence(15, "intro"),
    "## Screened by design", sentence(20, "parent"), "### Card one", sentence(25, "one"), "### Card two", sentence(25, "two"), "### Card three", sentence(25, "three"),
    "## Long family", sentence(20, "p2"), "### Big child", sentence(90, "big"), "### Small child", sentence(20, "small"),
  ].join("\n\n");
  const c = chunk(md, events);
  assert.deepEqual(c.map((x) => x.section), ["Screened by design", "Long family", "Big child", "Small child"]);
  assert.match(c[0]!.body, /intro0[\s\S]*## Screened by design[\s\S]*### Card one[\s\S]*### Card three[\s\S]*three24/);
  assert.ok(events.some((e) => e.kind === "merged_family" && e.section === "Screened by design"));
});

test("split: an FAQ section becomes one record per question, named by the question", () => {
  assert.equal(isQuestionBlock("What does the invented widget do?"), true);
  assert.equal(isQuestionBlock("## Is this a heading?"), false);
  assert.equal(isQuestionBlock("Where is it sold? In invented shops."), false);
  const md = [
    "# Widget Rooms", "## Invented FAQ",
    "What is a widget?", sentence(40, "w"), sentence(20, "w2"),
    "How do widgets help teams?", sentence(50, "h"),
    "Why choose widgets?", sentence(45, "y"),
    "Where can I ask more?", "[Contact](https://example.com/c/) us.",
  ].join("\n\n");
  const events: SplitEvent[] = [];
  const c = chunk(md, events);
  assert.deepEqual(c.map((x) => x.section), ["What is a widget?", "How do widgets help teams?", "Why choose widgets?"]);
  assert.equal(c[1]!.sectionPath, "Invented FAQ › How do widgets help teams?");
  assert.match(c[0]!.body, /^w0 [\s\S]*w219\.$/); // both answer paragraphs, question only in the breadcrumb
  assert.ok(events.some((e) => e.kind === "dropped_thin" && /Where can I ask more/.test(e.section)));
});

test("split: sub-headed cards leave the section they were filed under; small cards are packed, large ones stand alone", () => {
  const md = [
    "# Widget Rooms", "## Product section", sentence(60, "intro"),
    "##### Card A", sentence(20, "a"), "##### Card B", sentence(20, "b"), "##### Big card", sentence(80, "big"), "##### Card C", sentence(45, "c"),
  ].join("\n\n");
  const c = chunk(md);
  assert.deepEqual(c.map((x) => x.section), ["Product section", "Card A; Card B", "Big card", "Card C"]);
  assert.equal(c[1]!.sectionPath, "Product section › Card A; Card B");
  assert.match(c[1]!.body, /##### Card A[\s\S]*##### Card B/);
  assert.doesNotMatch(c[0]!.body, /Card A/);
  assert.equal(joinNames(["a".repeat(100), "b".repeat(100)]), "a".repeat(100));
  // limits are bytes: "™" is three bytes
  assert.ok(Buffer.byteLength(joinNames(["Widget™ ".repeat(10).trim(), "Widget™ ".repeat(10).trim()]), "utf8") <= 160);
  assert.ok(Buffer.byteLength(clipName("Widget’s room ".repeat(20)), "utf8") <= 160);
});

test("split: an over-long section is split at paragraph boundaries; lists, labels and attributions stay attached", () => {
  const blocks = [
    sentence(120, "p1"), "These invented items follow:", "- item one", "- item two", "- item three",
    "“An invented quote that is long enough to be a paragraph of its own here.”", "Invented Person", "Invented Title, Widget Co",
    sentence(120, "p2"), "**Invented label**", sentence(100, "p3"), sentence(100, "p4"),
  ];
  const parts = splitBalanced(blocks);
  assert.deepEqual(parts.flat(), blocks); // nothing lost, nothing added, order kept
  assert.ok(parts.length >= 2);
  for (const p of parts) {
    assert.notEqual(p[p.length - 1], "These invented items follow:");
    assert.notEqual(p[0], "Invented Person");
    assert.ok(!p[0]!.startsWith("- "), "a part never starts inside a list");
    assert.notEqual(p[p.length - 1], "**Invented label**");
  }
  const md = ["# Widget Rooms", "## Action", ...blocks].join("\n\n");
  const c = chunk(md);
  assert.ok(c.length >= 2 && c.every((x) => x.words <= 340), c.map((x) => x.words).join(","));
  assert.equal(c[0]!.section, "Action");
  assert.ok(c.some((x) => x.section === "Invented label"), "a bold label names the part it starts");
  assert.ok(c.some((x) => x.section === "Action (part 2)"));
});

test("records: a whole page with no usable sentence yields no record", () => {
  assert.equal(buildPageRecords(src(), raw("# Widget Rooms\n\nInvented highlights with results.\n")).records.length, 0);
});

// ---------------- duplicates ----------------
const rec = (id: string, sourceId: string, text: string): IngestRecord =>
  ({ id, sourceId, title: id, url: "https://example.com/x/", body: `Page › ${id}\n\n${text}\n`, metadata: { section: id } as never, additional: { contentHash: id }, relationIds: [] });

test("duplicates: the same passage on two pages is kept once (the fuller record, or the first of two identical ones)", () => {
  const a = "Invented tours of the widget room are available now. Experience the invented front row setup.";
  const records = [
    rec("short", "page-1", a),
    rec("full", "page-2", `${a} Take an invented virtual tour or book a visit today!`),
    rec("same-1", "page-1", "Invented goals paragraph one stands here. Invented goals paragraph two stands here."),
    rec("same-2", "page-3", "Invented goals paragraph one stands here. Invented goals paragraph two stands here."),
    rec("other", "page-3", "A completely different invented paragraph about widget audio."),
    rec("quoted", "derived", a),
  ];
  const { kept, dropped } = dropDuplicates(records, (id) => id === "derived");
  assert.deepEqual(kept.map((r) => r.id), ["full", "same-1", "other", "quoted"]);
  assert.deepEqual(dropped.map((d) => [d.dropped.id, d.keptId]), [["short", "full"], ["same-2", "same-1"]]);
});

// ---------------- tags ----------------
test("tags: room sizes with a product name in brackets or an adjective before the room word", () => {
  const sizes = (t: string) => detectRoomSizes(toTagLines(t));
  assert.deepEqual(sizes("Options for small (Widget Bar S) or mid-sized (Widget Bar M) meeting and collaboration spaces."), ["small", "medium"]);
  assert.deepEqual(sizes("The floor has two large divisible boardrooms."), ["large"]);
  assert.deepEqual(sizes("Scalable AV for medium-to-large conference rooms."), ["medium", "large"]);
  assert.deepEqual(sizes("Each site featured a collaboration (huddle) room."), ["huddle"]);
  // hard-wrapped PDF text: the phrase is read across the line break
  assert.deepEqual(detectTags({ body: "The building has large conference rooms, huddle\nspaces, and a cafeteria." }).room_sizes, ["huddle", "large"]);
  assert.deepEqual(detectTags({ body: "- Huddle\n- spaces for teams" }).room_sizes, []);
  assert.deepEqual(sizes("The room seats up to eight people."), []);
  assert.deepEqual(sizes("Large displays for every meeting space."), []);
});

test("tags: industry only from the record's own heading, exactly one, never from a joined card label", () => {
  assert.equal(detectIndustry({ headingPath: "Products › Government Workspaces", body: "Invented text." }), "government");
  assert.equal(detectIndustry({ headingPath: "Solutions", body: "From retail and restaurants to healthcare and education." }), null);
  assert.equal(detectIndustry({ headingPath: "Education Solutions", body: "Invented text." }), null);
  assert.equal(detectIndustry({ headingPath: "Team Workspace; Government Workspaces", body: "Invented text." }), null);
  assert.equal(detectIndustry({ headingPath: "Banks and hospitals", body: "Invented text." }), null);
});

test("stage: only records plainly about deployment/training or monitoring/support change stage", () => {
  const deploy = "We plan the rollout with you. Certified teams install every room. Training helps users adopt the rooms. A program manager leads the deployment.";
  assert.equal(detectStage({ headingPath: "Invented rollout", body: deploy })?.stage, "deploy");
  const run = "We monitor rooms around the clock. Our help desk answers 24/7. Preventative maintenance keeps rooms ready. Incidents become tickets automatically.";
  assert.equal(detectStage({ headingPath: "Invented care", body: run })?.stage, "run_support");
  // heading names it, a third of the sentences support it
  assert.equal(detectStage({ headingPath: "Installation", body: "Invented rooms are nice. Our crews install every display. Invented widgets are also nice." })?.stage, "deploy");
  // one passing mention, or a mix of both, keeps the page's stage
  assert.equal(detectStage({ headingPath: "Invented product", body: "The bar is easy to deploy. It has a camera. It has speakers. It has microphones." }), null);
  // three sentences are too few to move a record by its body alone
  assert.equal(detectStage({ headingPath: "Invented audit", body: "The audit covered monitoring and incident management. It confirms managed services. It covers ongoing support plans." }), null);
  assert.equal(detectStage({ headingPath: "Services", body: "We deploy rooms worldwide. We monitor rooms worldwide. We install displays. Our help desk answers 24/7." }), null);

  const md = ["# Widget Rooms", "## Invented product", sentence(30, "p"), "## Rollout and installation", deploy].join("\n\n");
  const recs = buildPageRecords(src({ stage: "choose_platform" }), raw(md)).records;
  assert.deepEqual(recs.map((r) => r.metadata.journey_stage), ["choose_platform", "deploy"]);
  // case studies keep their stage: findCaseStudies looks for "proof"
  const cs = buildPageRecords(src({ stage: "proof", contentType: "case_study", industry: "retail" }), raw(md)).records;
  assert.deepEqual(cs.map((r) => r.metadata.journey_stage), ["proof", "proof"]);
});

// ---------------- phase 2: sources added after the brief ----------------
test("clean: an anchor-linked card keeps its text; an empty strikethrough goes; follow/tell-me links are CTAs", () => {
  assert.equal(
    repairMarkup("- [**Invented support** \\\\\n\\\\\nWe provide invented upkeep.](https://example.com/p/#contact)"),
    "- **Invented support** We provide invented upkeep.",
  );
  assert.equal(repairMarkup("The invented team must manage. ~~~~\n\nNext."), "The invented team must manage.\n\nNext.");
  const out = cleanMarkdown(["# P", "## S", sentence(20, "s"), "[Follow Widget Co on InventedTube.](https://example.com/y)", "[**Tell me more about widgets**](https://example.com/w/)"].join("\n\n"));
  assert.doesNotMatch(out.markdown, /Follow|Tell me/);
});

test("split: a blog headline H1 under its date line is not repeated in the record it names", () => {
  const recs = buildPageRecords(src({ contentType: "blog", title: "Invented post" }), raw(["Oct 7 - 2099", "# Invented Widget Headline", sentence(30, "a"), "## Second part", sentence(30, "b")].join("\n\n"))).records;
  assert.equal(recs[0]!.metadata.section, "Invented Widget Headline");
  assert.equal(recs[0]!.body.match(/Invented Widget Headline/g)?.length, 1); // breadcrumb only
  assert.match(recs[0]!.body, /Oct 7 - 2099/);
});

test("prep: a quotation the page cuts off loses only its unfinished sentence", async () => {
  const { dropTruncatedQuoteTail } = await import("../new-prep");
  const md = "Intro paragraph.\n\nInvented Person commented, “This is complete. This one is cut off and we are ready to\n\n## Project Partners\n\nlogos";
  const r = dropTruncatedQuoteTail(md, /\n## Project Partners\b/);
  assert.equal(r.dropped, "This one is cut off and we are ready to");
  assert.match(r.markdown, /“This is complete\.\n\n## Project Partners/);
  // a finished quote is left alone
  const ok = "Invented Person said, “All complete.”\n\n## Project Partners\n";
  assert.equal(dropTruncatedQuoteTail(ok, /\n## Project Partners\b/).markdown, ok);
});

test("relations: sources added after the brief link one way; the picture record is never built by prepare", async () => {
  const { applyRelations } = await import("../relations");
  const recs = [rec("old-1", "symphony", "x"), rec("new-1", "rmit-symphony", "y")];
  applyRelations(recs, [], { "rmit-symphony": ["symphony"] });
  assert.deepEqual(recs.map((r) => r.relationIds), [[], ["old-1"]]);
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const prepareSrc = readFileSync(fileURLToPath(new URL("../prepare.ts", import.meta.url)), "utf8");
  assert.doesNotMatch(prepareSrc, /buildImageRecords|transcriptions\.json/);
});
