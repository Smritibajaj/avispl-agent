import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ChunkMetadataSchema, type IngestRecord } from "@avispl/shared";
import { PKG_ROOT } from "../paths";
import { cleanMarkdown, domHeadings, findRepeatedBlocks, parseCaseStudyLabels, repairHeadings, sectionRelevance, stageForHeading, wordCount } from "../clean";
import { chunkSections, isLabelIndex, isLinkOnly, parseSections, stableId, MAX_WORDS } from "../split";
import { applyRelations } from "../relations";
import { buildPageRecords, validateRecord, applyApprovals, clip } from "../prepare";
import { SOURCES, validateManifest, type ManifestEntry } from "../sources";
import { canScrape, isPermanent } from "../scrape";
import { findDisclosureCandidates } from "../extract-disclosure";
import { autoRanges, parseRange } from "../pdf";
import type { RawScrape } from "../scrape";

const LABEL = "SYNTHETIC TEST FIXTURE, NOT AVI-SPL CONTENT";
function fixture(name: string): string {
  const txt = readFileSync(join(PKG_ROOT, "fixtures", "synthetic", name), "utf8");
  const [first, ...rest] = txt.split("\n");
  assert.equal(first?.trim(), LABEL, `${name} must start with the synthetic label`);
  return rest.join("\n");
}

const fakeSource = (over: Partial<ManifestEntry> = {}): ManifestEntry => ({
  id: "synthetic-page", n: 999, title: "Widget Rooms", url: "https://example.com/widget-rooms/",
  stage: "plan_design", contentType: "page", priority: "P0", goldenQueries: ["Q1"], status: "ready", ...over,
});
const fakeRaw = (markdown: string, id = "synthetic-page", url = "https://example.com/widget-rooms/"): RawScrape => ({
  id, url, requestedAt: "2026-11-10T00:00:00.000Z", scrapedAt: "2026-11-10T00:00:01.000Z", attempts: 1,
  options: {}, markdown, metadata: { title: "Widget Rooms | AVI-SPL", modifiedTime: "2026-01-02T03:04:05Z" },
});

// ---------------- cleaning ----------------
test("clean: removes boilerplate by structure, keeps content without the phrase 'meeting room'", () => {
  const { markdown, removed } = cleanMarkdown(fixture("page-with-boilerplate.md"));
  const kinds = new Set(removed.map((r) => r.kind));
  for (const k of ["mega_menu", "country_list", "state_list", "footer", "logo_marquee", "cta_only"]) assert.ok(kinds.has(k as never), `expected ${k} removed, got ${[...kinds]}`);
  assert.doesNotMatch(markdown, /Video Walls|Esports|Alabama|Germany|All rights reserved|Privacy Policy|Skip to content|Learn more|!\[/);
  assert.match(markdown, /projector brightness/); // no "meeting room" words, must survive
  assert.match(markdown, /^## Planning widgets$/m);
  assert.match(markdown, /^### Widget audio$/m);
  assert.match(markdown, /- Measure the space twice\n- Pick a widget size\n- Write it down/);
  assert.match(markdown, /\| Widget size \| Seats \| Example note \|\n\|---\|---\|---\|\n\| Tiny \| 2 \| invented \|\n\| Big \| 12 \| invented \|/);
  assert.match(markdown, /Features depend on licensing/); // disclaimer kept
});

test("clean: repeated-block heuristic drops site chrome but never disclaimers", () => {
  const chrome = "Sign up for the invented newsletter today and get invented news.";
  const disclaimer = "* Features depend on licensing and region (synthetic).";
  const pages = [1, 2, 3, 4].map((i) => `# Page ${i}\n\nUnique body text number ${i} for page.\n\n${chrome}\n\n${disclaimer}\n`);
  const rep = findRepeatedBlocks(pages);
  const out = cleanMarkdown(pages[0]!, rep).markdown;
  assert.doesNotMatch(out, /newsletter/);
  assert.match(out, /Features depend on licensing/);
  assert.match(out, /Unique body text number 1/);
});

// ---------------- case studies ----------------
test("case study: labels parsed by LABEL not position (inline, multi-line, SOLUTIONS)", () => {
  const { markdown } = cleanMarkdown(fixture("case-study.md"));
  const { labels, body } = parseCaseStudyLabels(markdown);
  assert.equal(labels.organization, "Fabrikam Example Agency");
  assert.equal(labels.location, "Springfield, Nowhere");
  assert.equal(labels.market, "Retail");
  assert.equal(labels.services, "Invented design; invented install");
  assert.equal(labels.solution, "Imaginary video system; Pretend control panel");
  assert.doesNotMatch(body, /^\**(ORGANIZATION|MARKET|SOLUTIONS)\**$/m);
  assert.match(body, /Location of the problem was everywhere/); // prose "Location" is not a label
});

test("case study: section headings map to stages", () => {
  assert.equal(stageForHeading("PLAN", "proof"), "plan_design");
  assert.equal(stageForHeading("DEPLOY", "proof"), "deploy");
  assert.equal(stageForHeading("OPERATE", "proof"), "run_support");
  assert.equal(stageForHeading("The Challenge", "plan_design"), "proof");
  assert.equal(stageForHeading("Results", "plan_design"), "proof");
  assert.equal(stageForHeading("Impact", "plan_design"), "proof");
  assert.equal(stageForHeading("Something else", "proof"), "proof");
});

test("case study: records use curated industry, never the page MARKET", () => {
  const src = fakeSource({ id: "synthetic-cs", contentType: "case_study", stage: "proof", industry: "government", url: "https://example.com/cs/" });
  const b = buildPageRecords(src, fakeRaw(fixture("case-study.md"), "synthetic-cs", "https://example.com/cs/"));
  assert.ok(b.records.length >= 4);
  for (const r of b.records) {
    assert.equal(r.metadata.industry, "government");
    assert.equal(r.metadata.cs_organization, "Fabrikam Example Agency");
    assert.equal(r.metadata.cs_location, "Springfield, Nowhere");
    assert.match(r.additional.crawlNotes ?? "", /MARKET label "Retail" ignored/);
  }
  const stages = new Set(b.records.map((r) => r.metadata.journey_stage));
  for (const s of ["plan_design", "deploy", "run_support", "proof"]) assert.ok(stages.has(s as never), `missing stage ${s}`);
});

// ---------------- partial scope ----------------
test("partial_scope: per-section relevance (keep / uncertain -> relevant=false / drop)", () => {
  assert.equal(sectionRelevance("a meeting room for hybrid meeting"), "keep");
  assert.equal(sectionRelevance("a video wall and digital signage"), "drop");
  assert.equal(sectionRelevance("our history"), "uncertain");
  const src = fakeSource({ id: "synthetic-partial", status: "partial_scope", contentType: "industry_page", stage: "proof", industry: "healthcare" });
  const md = fixture("partial-scope.md");
  const b = buildPageRecords(src, fakeRaw(md, "synthetic-partial"));
  assert.deepEqual(b.droppedSections, ["Giant video walls"]);
  const all = b.records.map((r) => r.body).join("\n");
  assert.doesNotMatch(all, /video wall/);
  assert.ok(b.records.some((r) => r.metadata.meeting_room_relevant === true && /Hybrid collaboration/.test(r.body)));
  assert.ok(b.records.some((r) => r.metadata.meeting_room_relevant === false && /Our history/.test(r.body)));
});

// ---------------- splitting ----------------
const para = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `${tag}${i}`).join(" ");

test("split: one record per H2/H3 even on small pages; section is ONE heading; breadcrumb first line", () => {
  const b = buildPageRecords(fakeSource(), fakeRaw(fixture("page-with-boilerplate.md")));
  const sections = b.records.map((r) => r.metadata.section);
  // the short untitled page intro joins the first headed section instead of standing as "Overview"
  assert.deepEqual(sections, ["Planning widgets", "Widget audio", "Disclaimers"]);
  assert.match(b.records[2]!.body, /Features depend on licensing/);
  for (const r of b.records) {
    assert.doesNotMatch(r.metadata.section, / · |…/);
    assert.match(r.body.split("\n")[0]!, /^Widget Rooms › /);
  }
  assert.equal(b.records[1]!.body.split("\n")[0], "Widget Rooms › Planning widgets › Widget audio");
  assert.equal(b.records[0]!.metadata.page_title, "Widget Rooms");
});

test("split: thin headed sections dropped; big ones split <=900 words; tables whole", () => {
  const table = ["| a | b |", "|---|---|", ...Array.from({ length: 30 }, (_, i) => `| row${i} | ${para(5, "c")} |`)].join("\n");
  const md = [
    "# Big", "## One", para(200, "one"), "### One A", para(150, "onea"), "### One B", para(5, "tiny"),
    "## Two", para(700, "two"), "## Three", para(500, "x"), "", para(600, "y"), "## Four", table, "## Five", para(50, "five"),
  ].join("\n\n");
  const chunks = chunkSections(parseSections(md, "Big", { defaultStage: "plan_design" }));
  // "One B" (5 words) is below the substance floor: dropped, not merged into a neighbour.
  assert.deepEqual(chunks.map((c) => c.section), ["One", "One A", "Two", "Three", "Three (part 2)", "Four", "Five"]);
  assert.doesNotMatch(chunks.map((c) => c.body).join("\n"), /tiny0/);
  for (const c of chunks) assert.ok(c.words <= MAX_WORDS + 20, `${c.section} ${c.words} words`);
  const withTable = chunks.find((c) => c.body.includes("| row0 |"))!;
  assert.ok(withTable.body.includes("| row29 |"), "table split across chunks");
  assert.equal(new Set(chunks.map((c) => c.slug)).size, chunks.length);
});

test("split: link-only sections (blog teasers, lone CTA) are dropped", () => {
  assert.equal(isLinkOnly({ heading: "Blog", blocks: ["### Blog", "Oct 24, 2025", "[Invented post](https://example.com/p)", "11"] }), true);
  assert.equal(isLinkOnly({ heading: "Vendors", blocks: ["### Vendors", "We support these invented vendors today.", "- [A](https://example.com/a)"] }), false);
});

test("split: stable id = sha1(url#slug) and deterministic", () => {
  assert.equal(stableId("https://example.com/a/", "intro"), stableId("https://example.com/a/", "intro"));
  assert.notEqual(stableId("https://example.com/a/", "intro"), stableId("https://example.com/a/", "intro-2"));
  assert.match(stableId("https://example.com/a/", "intro"), /^[0-9a-f]{40}$/);
  const a = buildPageRecords(fakeSource(), fakeRaw(fixture("page-with-boilerplate.md"))).records.map((r) => r.id);
  const b = buildPageRecords(fakeSource(), fakeRaw(fixture("page-with-boilerplate.md"))).records.map((r) => r.id);
  assert.deepEqual(a, b);
});

// ---------------- records ----------------
test("records: validate against ChunkMetadataSchema, needs_review default, no local-only fields", () => {
  const recs = buildPageRecords(fakeSource({ always: { topics: "standardization" }, defaults: { requires_disclosure: false } }), fakeRaw(fixture("page-with-boilerplate.md"))).records;
  for (const r of recs) {
    validateRecord(r);
    assert.equal(r.metadata.status, "needs_review");
    assert.equal(r.metadata.last_modified, "2026-01-02");
    assert.equal(r.metadata.last_crawled, "2026-11-10");
    assert.ok(!("priority" in r.metadata) && !("goldenQueries" in r.metadata));
    assert.ok(!JSON.stringify(r).includes("goldenQueries") && !JSON.stringify(r).includes('"priority"'));
    assert.equal(r.metadata.requires_disclosure, false);
  }
});

test("records: Copilot/Places/Teams Premium text forces requires_disclosure", () => {
  const recs = buildPageRecords(fakeSource(), fakeRaw("# Widget Rooms\n\nInvented text mentioning Microsoft Places for testing, long enough to pass the substance floor of twelve words.\n")).records;
  assert.equal(recs[0]!.metadata.requires_disclosure, true);
});

test("records: additional over 1024 bytes and invalid metadata are rejected", () => {
  const r = buildPageRecords(fakeSource(), fakeRaw(fixture("page-with-boilerplate.md"))).records[0]!;
  assert.throws(() => validateRecord({ ...r, additional: { contentHash: "x", crawlNotes: "z".repeat(1100) } }), /additional/);
  assert.throws(() => validateRecord({ ...r, metadata: { ...r.metadata, industry: "aquariums" as never } }), /metadata invalid/);
  assert.throws(() => validateRecord({ ...r, metadata: { ...r.metadata, priority: "P0" } as never }), /metadata invalid|local-only/);
});

test("records: approvals bound to content hash", () => {
  const recs = buildPageRecords(fakeSource(), fakeRaw(fixture("page-with-boilerplate.md"))).records;
  const r = recs[0]!;
  assert.equal(applyApprovals(recs, { [r.id]: "stale-hash" }), 0);
  assert.equal(r.metadata.status, "needs_review");
  assert.equal(applyApprovals(recs, { [r.id]: r.additional.contentHash }), 1);
  assert.equal(r.metadata.status, "published");
});

// ---------------- truncated URLs ----------------
test("truncated URLs: manifest, schema and record validation all reject them", () => {
  const bad = { ...SOURCES[0]!, url: "https://pages.example.com/hubfs/Some%20File%20…" };
  assert.ok(validateManifest([bad, ...SOURCES.slice(1)]).some((p) => /truncated/.test(p)));
  const ascii = { ...SOURCES[0]!, url: "https://pages.example.com/hubfs/Some%20File..." };
  assert.ok(validateManifest([ascii, ...SOURCES.slice(1)]).some((p) => /truncated/.test(p)));
  const r = buildPageRecords(fakeSource(), fakeRaw(fixture("page-with-boilerplate.md"))).records[0]!;
  const t = "https://example.com/hubfs/file%20…";
  assert.throws(() => validateRecord({ ...r, url: t, metadata: { ...r.metadata, source_url: t } }), /truncated/);
  assert.equal(ChunkMetadataSchema.safeParse({ ...r.metadata, source_url: t }).success, false);
});

test("manifest: real manifest is valid; 60 numbered sources; truncated ones have url null", () => {
  assert.deepEqual(validateManifest(SOURCES), []);
  const nr = SOURCES.filter((s) => s.status === "needs_resolution");
  assert.deepEqual(nr.map((s) => s.n).sort((a, b) => a - b), [6, 7]); // 9 and 35 were resolved from scraped pages
  for (const s of nr) { assert.equal(s.url, null); assert.ok(s.truncatedUrl?.endsWith("…")); }
  const missing = SOURCES.filter((s) => s.n !== 13);
  assert.ok(validateManifest(missing).some((p) => /#13 missing/.test(p)));
});

test("scrape guards: blocked statuses never scraped; P0 scrape set is exactly the 7 pages", () => {
  for (const s of SOURCES.filter((x) => ["login_required", "gated", "dead_link", "needs_resolution", "off_scope", "page_ranges_needed"].includes(x.status)))
    assert.equal(canScrape(s).ok, false, s.id);
  const p0 = SOURCES.filter((s) => s.priority === "P0" && canScrape(s).ok).map((s) => s.id).sort();
  assert.deepEqual(p0, ["bernalillo-county", "idrc", "meeting-rooms", "microsoft-practice", "ref-designs-page", "smart-workplace-ebook", "symphony"]);
  assert.equal(canScrape(fakeSource({ url: "https://avispl.co.uk/x/" })).ok, false, "regional site must be rejected");
  assert.equal(isPermanent(new Error("your IP address looks like a VPN or proxy")), true);
  assert.equal(isPermanent(Object.assign(new Error("rate"), { status: 429 })), false);
});

// ---------------- relations ----------------
test("relations: source links resolve to the target's primary record; missing targets reported", () => {
  const mk = (id: string, sourceId: string) => ({ id, sourceId, relationIds: [] as string[] }) as unknown as IngestRecord;
  const recs = [mk("a1", "A"), mk("a2", "A"), mk("b1", "B"), mk("b2", "B")];
  const unresolved = applyRelations(recs, [{ name: "t", sources: ["A", "B", "C"] }]);
  assert.deepEqual(recs[0]!.relationIds, ["b1"]);
  assert.deepEqual(recs[1]!.relationIds, ["b1"]);
  assert.deepEqual(recs[2]!.relationIds, ["a1"]);
  assert.deepEqual(unresolved, ["A -> C", "B -> C"]);
});

// ---------------- disclosure + pdf helpers ----------------
test("disclosure: finds the licensing paragraph verbatim", () => {
  const c = findDisclosureCandidates(cleanMarkdown(fixture("ebook-licensing.md")).markdown);
  assert.ok(c.length >= 1);
  assert.equal(c[0]!.block, "Some invented features require a Teams Premium or Copilot licence, and depend on tenant configuration and region. (Synthetic wording, not a real disclosure.)");
});

test("pdf: page ranges parse and auto-ranges stay within limits", () => {
  assert.deepEqual(parseRange("41-47", 84), [41, 47]);
  assert.throws(() => parseRange("80-90", 84));
  const pages = Array.from({ length: 6 }, (_, i) => para(250, `p${i}`));
  const r = autoRanges(pages);
  assert.ok(r.length >= 2);
  for (const x of r) { const [a, b] = parseRange(x.range, 6); const w = pages.slice(a - 1, b).reduce((n, p) => n + wordCount(p), 0); assert.ok(w <= MAX_WORDS, `${x.range} ${w}`); }
});

test("case study: label values (not MARKET) kept in the body as an at-a-glance line", () => {
  const src = fakeSource({ id: "synthetic-cs", contentType: "case_study", stage: "proof", industry: "government", url: "https://example.com/cs/" });
  const b = buildPageRecords(src, fakeRaw(fixture("case-study.md"), "synthetic-cs", "https://example.com/cs/"));
  const first = b.records[0]!;
  assert.match(first.body, /At a glance\.\*\* Organization: Fabrikam Example Agency · Location: Springfield, Nowhere · Services: Invented design; invented install · Solution: Imaginary video system; Pretend control panel/);
  assert.doesNotMatch(b.records.map((r) => r.body).join("\n"), /Retail/);
});

// ---------------- fixes after the first live scrape (synthetic reproductions) ----------------
test("headings: spacing repaired from DOM headings (spans, <br>, entities); never invents splits", () => {
  const html = '<h1><span class="word"><span>Example</span></span><span class="whitespace"> </span><span class="word"><span>Widget</span></span><br><span>Rooms</span></h1>' +
    "<h2>How can <br>\nwe help&nbsp;&amp; why?</h2><h3>High-Impact <br>\nHybrid Widgets</h3>";
  assert.deepEqual(domHeadings(html).map((h) => h.text), ["Example Widget Rooms", "How can we help & why?", "High-Impact Hybrid Widgets"]);
  const md = "# ExampleWidget  Rooms\n\ntext\n\n## Howcan  wehelp & why?\n\n### High-Impact    Hybrid Widgets\n\n### NoDomMatchHere\n";
  const r = repairHeadings(md, html);
  assert.match(r.markdown, /^# Example Widget Rooms$/m);
  assert.match(r.markdown, /^## How can we help & why\?$/m);
  assert.match(r.markdown, /^### High-Impact Hybrid Widgets$/m);
  assert.match(r.markdown, /^### NoDomMatchHere$/m); // left alone, only reported
  assert.deepEqual(r.unmatched, ["NoDomMatchHere"]);
  assert.match(repairHeadings("## A    B\n", undefined).markdown, /^## A B$/m);
});

test("clean: one-label-per-block form region, duplicates, stat merge, inverted headings, link lists kept", () => {
  const { markdown, removed } = cleanMarkdown(fixture("form-and-dupes.md"));
  assert.doesNotMatch(markdown, /First name|Work email|Alabama|Form Type|unsubscribe|I agree|Request a Demo/);
  assert.ok(removed.some((r) => r.kind === "form"));
  assert.equal(markdown.split("Invented paragraph that the responsive layout").length - 1, 1, "duplicate paragraph kept twice");
  assert.match(markdown, /^## FEATURE ONE LABEL$/m, "heading must not be deduped against a body label");
  assert.match(markdown, /^84% fewer invented tickets$/m);
  assert.match(markdown, /## Invented features for testing the cleaner\n\n\*\*Invented pillar\*\*/);
  assert.match(markdown, /- \[\*\*VendorD\*\*\]/, "bullet link list is content");
  assert.match(markdown, /Closing invented section/);
  const { labels, body } = parseCaseStudyLabels(markdown);
  assert.equal(labels.organization, "Example Org, Nowhere");
  assert.equal(labels.location, "Example Org, Nowhere", "repeated short label value must survive dedupe");
  assert.equal(labels.market, "Retail");
  assert.doesNotMatch(body, /Market|Retail/);
});

test("section/title clipping: word boundary, never an ellipsis", () => {
  const long = "With the integration of invented phone, invented rooms, invented premium and invented assistant, ".repeat(3);
  const c = clip(long, 160);
  assert.ok(c.length <= 160);
  assert.doesNotMatch(c, /…|\.\.\.$/);
  assert.ok(long.startsWith(c));
  assert.match(c, /\w$/);
});

test("CTA blocks, eyebrows, counters, thin sections dropped; link lists, label values, item-name runs kept", () => {
  const md = [
    "# Example", "## Real section", "Invented substantive text about invented widgets that explains what the widgets actually do for users.",
    "Curious how invented widgets could help your team? [Listen to our podcast to find out more.](https://example.com/p)",
    "[Read the Case Study](https://example.com/cs)",
    "- [**VendorA**](https://example.com/a)\n- [**VendorB**](https://example.com/b)\n- [**VendorC**](https://example.com/c)\n- [**VendorD**](https://example.com/d)",
    "Services", "### Fragment card section", "support invented operations.", "### Item names",
    "##### Tiny Widget", "[Open image gallery](https://example.com/g)", "##### Big Widget", "##### Huge Widget", "13", "## Later section",
    "#### Location", "Springfield, Nowhere", "#### Market", "Retail",
    "Invented closing text long enough to count as a real section for the substance floor rule.",
  ].join("\n\n");
  const { markdown, removed } = cleanMarkdown(md);
  assert.doesNotMatch(markdown, /podcast|Read the Case Study|Open image gallery|^Services$|^13$/m);
  for (const k of ["cta_block", "eyebrow"]) assert.ok(removed.some((r) => r.kind === k), k);
  assert.ok(removed.some((r) => r.preview === "13"), "counter removed");
  assert.match(markdown, /- \[\*\*VendorD\*\*\]/);
  assert.match(markdown, /- Tiny Widget\n- Big Widget\n- Huge Widget/);
  assert.equal(parseCaseStudyLabels(markdown).labels.location, "Springfield, Nowhere");
  const secs = parseSections(markdown, "Example", { defaultStage: "plan_design" });
  const names = chunkSections(secs).map((c) => c.section);
  assert.ok(!names.includes("Fragment card section"), "thin fragment section must be dropped");
  assert.ok(names.includes("Item names") && names.includes("Real section"));
  assert.equal(isLabelIndex({ heading: "X", blocks: ["## X", "Tab One", "Tab Two Label"] }), true);
  assert.equal(isLabelIndex({ heading: "X", blocks: ["## X", "Standardization and hot desking", "support airport operations."] }), false);
});
