import { test } from "node:test";
import assert from "node:assert/strict";
import { createChatResponse } from "./agent";
import { bestSentences, cleanHitText, composeDemoAnswer, createDemoModel, DEMO_PENDING_SENTENCE, excerpt, hitHeading } from "./demo-model";
import { getLicensingDisclosure } from "./disclosure";
import { resolveModelMode } from "./env";
import type { SearchToolOutput, ToolHit } from "./tool-logic";
import { FIXTURE_MARK } from "./knowledge/fixtures";
import { MockKnowledgeStore } from "./knowledge/mock-store";
import { extractEvidence } from "./message-evidence";
import { readFinalMessage, userMessage } from "./test-stream";
import { GOLDEN_QUERIES } from "./golden-queries";

/** What an answer must carry for licensing: the pending sentence, or the approved text word for word. */
const expectedLicensing = async () => {
  const d = await getLicensingDisclosure();
  return { pending: d.pending, line: d.pending ? DEMO_PENDING_SENTENCE : d.text };
};

const run = async (q: string) => {
  const res = await createChatResponse({ model: createDemoModel({ chunkDelayMs: 0 }), messages: userMessage(q), store: new MockKnowledgeStore() });
  assert.equal(res.status, 200);
  const { message, textDeltas } = await readFinalMessage(res);
  assert.ok(message);
  return { ev: extractEvidence(message.parts), textDeltas };
};

test("golden queries: every citation resolves to a retrieved hit, and every bullet quotes hit text", async () => {
  for (const q of GOLDEN_QUERIES) {
    const { ev, textDeltas } = await run(q);
    assert.ok(ev.searches >= 1, q);
    assert.ok(ev.cited.length >= 2 && ev.cited.length <= 4, `${ev.cited.length} cites for: ${q}`);
    for (const r of ev.cited) assert.ok(ev.hits.has(r), `unresolved ${r}`);
    assert.ok(textDeltas > 5, "text must stream in several chunks");
    for (const line of ev.text.split("\n").filter((l) => l.startsWith("- **"))) {
      const quoted = /"(.+)" \[S\d+\]$/.exec(line)?.[1];
      const ref = /\[(S\d+)\]$/.exec(line)?.[1];
      assert.ok(quoted && ref, line);
      const h = ev.hits.get(ref)!;
      const clean = cleanHitText(h.text, h.title);
      for (const piece of quoted.split(/ … |; /)) assert.ok(clean.includes(piece.replace(/…$/, "")), `bullet not taken from hit text: ${line}`);
    }
    assert.ok(!ev.text.includes(FIXTURE_MARK));
  }
});

test("proof-style question also calls findCaseStudies; licensing question gets the pending sentence or the approved text verbatim, never other wording", async () => {
  const { ev } = await run(GOLDEN_QUERIES[1]);
  assert.equal(ev.searches, 2);
  const lic = await expectedLicensing();
  assert.equal(ev.disclosure?.pending, lic.pending);
  assert.ok(ev.text.includes(lic.line));
  assert.ok([...ev.hits.values()].some((h) => h.journeyStage === "proof" && ev.cited.includes(h.ref)), "a proof hit is cited");
});

test("disclosure is fetched when a cited hit requires it even if the user did not name a product", async () => {
  const { ev } = await run("what is needed in place for workplace management in Teams Rooms");
  const citedNeedsDisclosure = ev.cited.some((r) => ev.hits.get(r)?.flags.requiresDisclosure);
  assert.ok(citedNeedsDisclosure);
  const lic = await expectedLicensing();
  assert.equal(ev.disclosure?.pending, lic.pending);
  assert.ok(ev.text.includes(lic.line));
});

test("Q1 (reference designs) is not mistaken for a proof question", async () => {
  const { ev } = await run(GOLDEN_QUERIES[0]);
  assert.equal(ev.searches, 1);
});

test("no hits -> clear no-evidence reply with no citations", async () => {
  const { ev } = await run("Can you design an aquarium for our lobby?");
  assert.equal(ev.hits.size, 0);
  assert.equal(ev.cited.length, 0);
  assert.match(ev.text, /found no evidence/);
});

test("approved disclosure is appended verbatim; store failure gives an honest reply", () => {
  const hit: ToolHit = { ref: "S1", chunkId: "c", sourceId: "s", text: "Some retrieved sentence here.", title: "T", sourceUrl: "https://example.com/x", pageTitle: "T", section: "", journeyStage: "choose_platform", contentType: "page", flags: { legacyPlatform: false, metricsAreEstimates: false, requiresDisclosure: true }, score: 1, cautions: [] };
  const search: SearchToolOutput = { kind: "search", query: "q", backend: "mock", hits: [hit], graph: [], relaxed: false, appliedFilters: {} };
  const approved = "Exact approved wording, line 1.\nLine 2.";
  const txt = composeDemoAnswer({ searches: [{ ...search, hits: [{ ...hit }] }], disclosure: { pending: false, text: approved, instruction: "" } });
  assert.ok(txt.includes(approved));
  assert.ok(!txt.includes(DEMO_PENDING_SENTENCE));
  const down = composeDemoAnswer({ searches: [{ ...search, hits: [], unavailable: true }] });
  assert.match(down, /could not be searched/);
  assert.equal(excerpt(`${FIXTURE_MARK} First retrieved sentence is right here. Second one.`), "First retrieved sentence is right here.");
});

test("model mode: explicit demo, dev fallback only in development, 503 in production without a key", () => {
  assert.equal(resolveModelMode({ CHAT_MODEL: "demo", NODE_ENV: "production" } as never).kind, "demo");
  assert.equal(resolveModelMode({ NODE_ENV: "development" } as never).kind, "demo");
  assert.equal(resolveModelMode({ NODE_ENV: "production" } as never).kind, "unconfigured");
  assert.equal(resolveModelMode({ NODE_ENV: "test" } as never).kind, "unconfigured");
  const gw = resolveModelMode({ NODE_ENV: "development", AI_GATEWAY_API_KEY: "x" } as never);
  assert.deepEqual(gw, { kind: "gateway", id: "anthropic/claude-opus-5.5" });
});

test("breadcrumb, markdown headings, links and emphasis are stripped; quotes stay verbatim", () => {
  const text = [
    "Microsoft › How can we help?",
    "",
    "## How can we help?",
    "",
    "Our [Microsoft Teams Rooms](https://avispl.com/microsoft-teams) experts **design** and deploy rooms. Pricing is not shown here.",
    "",
    "### Monitoring",
    "- Rooms are monitored around the clock by the support centre.",
  ].join("\n");
  const clean = cleanHitText(text, "Microsoft › How can we help?");
  assert.ok(!clean.includes("›"));
  assert.ok(!clean.includes("#"));
  assert.ok(!clean.includes("](") && !clean.includes("**"));
  assert.ok(!clean.startsWith("-"));
  const list = "Reference Designs › Explore\n\n### Explore\n\n- Small Meeting Room\n- Medium Meeting Room\n- Large Conference Room\n";
  assert.deepEqual(bestSentences({ text: list, title: "" }, "which rooms"), ["Small Meeting Room; Medium Meeting Room; Large Conference Room"]);
  const best = bestSentences({ text, title: "Microsoft › How can we help?" }, "how are rooms monitored?");
  assert.ok(best.includes("Rooms are monitored around the clock by the support centre."));
  assert.ok(best.length <= 2);
  for (const b of best) assert.ok(clean.includes(b));
  assert.equal(hitHeading({ section: "Monitoring", pageTitle: "Symphony", title: "Symphony › Monitoring" }), "Monitoring · Symphony");
  assert.equal(hitHeading({ section: "Overview", pageTitle: "Symphony", title: "Symphony › Overview" }), "Symphony");
  assert.equal(bestSentences({ text: "Uptime rose to 99.5 percent after rollout. Other text here too.", title: "" }, "uptime")[0], "Uptime rose to 99.5 percent after rollout.");
});

test("multi-stage answers are grouped under journey-stage headings and the Sources line is compact", async () => {
  const { ev } = await run(GOLDEN_QUERIES[1]);
  assert.match(ev.text, /^### Choose platform$/m);
  assert.match(ev.text, /^### Proof$/m);
  assert.match(ev.text, /^I found \d+ relevant passages? in \d+ sources?, covering /);
  assert.match(ev.text, /^Sources: \[S\d+\] .+ · \[S\d+\]/m);
  assert.ok(!/https?:\/\//.test(ev.text.split("Sources:")[1] ?? ""), "compact sources: no raw URLs");
});

test("keyword noise is not quoted: hits sharing only one query term give the no-evidence reply", () => {
  const mk = (ref: string, text: string): ToolHit => ({ ref, chunkId: ref, sourceId: ref, text, title: "Reference Designs › Room designs", sourceUrl: "https://example.com/" + ref, pageTitle: "Reference Designs", section: "Room designs", journeyStage: "plan_design", contentType: "page", flags: { legacyPlatform: false, metricsAreEstimates: false, requiresDisclosure: false }, score: 1, cautions: [] });
  const search: SearchToolOutput = { kind: "search", query: "q", backend: "hydra", hits: [mk("S1", "Our design teams create meeting room designs for every size of space.")], graph: [], relaxed: false, appliedFilters: {} };
  assert.match(composeDemoAnswer({ searches: [search], query: "Can you design an aquarium for our lobby?" }), /found no evidence/);
  assert.match(composeDemoAnswer({ searches: [search], query: "which meeting room designs do you have?" }), /\[S1\]/);
});
