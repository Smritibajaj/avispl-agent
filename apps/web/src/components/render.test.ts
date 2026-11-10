import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MockKnowledgeStore } from "../lib/knowledge/mock-store";
import { RefRegistry } from "../lib/refs";
import { extractEvidence } from "../lib/message-evidence";
import { runFindCaseStudies, runSearchJourney } from "../lib/tool-logic";
import { AssistantMessage } from "./AssistantMessage";

test("answer hides [S#] markers, no source cards, licensing notice, no CTA or copy button; no graph UI", async () => {
  const store = new MockKnowledgeStore();
  const reg = new RefRegistry();
  const a = await runSearchJourney(store, reg, { query: "monitoring escalation support" });
  const b = await runFindCaseStudies(store, reg, { platform: "microsoft" });
  const legacy = b.hits.find((h) => h.flags.legacyPlatform)!;
  const est = b.hits.find((h) => h.flags.metricsAreEstimates)!;
  const first = a.hits[0]!;
  const parts = [
    { type: "tool-searchJourney", state: "output-available", output: a },
    { type: "tool-findCaseStudies", state: "output-available", output: b },
    { type: "tool-getLicensingDisclosure", state: "output-available", output: { pending: true, instruction: "x" } },
    { type: "text", text: `Rooms are monitored [${first.ref}]. Older proof [${legacy.ref}], estimates [${est.ref}]. Bad [S77].` },
  ];
  const ev = extractEvidence(parts);
  const html = renderToStaticMarkup(
    createElement(AssistantMessage, { ev, streaming: false }),
  );
  assert.doesNotMatch(html, /Searched \d+ time/);
  assert.doesNotMatch(html, /\[S\d+\]|class="cite/, "citation chips are not shown");
  assert.match(html, /Rooms are monitored\. Older proof, estimates\. Bad\./, "text reads cleanly without the markers");
  assert.doesNotMatch(html, /source-card|Also retrieved|Retrieved sources/);
  assert.match(html, /pending approval/);
  assert.doesNotMatch(html, /Next step|cta-btn|Copy/, "no copy button and no next-step button");

  assert.doesNotMatch(html, /Graph ·|graph-/);
});
