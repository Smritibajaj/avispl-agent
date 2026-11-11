import assert from "node:assert/strict";
import { test } from "node:test";
import { disclosureEnabled } from "../config/disclosure";
import { createChatResponse } from "./agent";
import { createDemoModel } from "./demo-model";
import { MockKnowledgeStore } from "./knowledge/mock-store";
import { extractEvidence } from "./message-evidence";
import { SYSTEM_PROMPT, systemPrompt } from "./system-prompt";
import { readFinalMessage, userMessage } from "./test-stream";
import { GOLDEN_QUERIES } from "./golden-queries";

test("disclosure switch: off unless LICENSING_DISCLOSURE=on", () => {
  assert.equal(disclosureEnabled({} as NodeJS.ProcessEnv), false);
  assert.equal(disclosureEnabled({ LICENSING_DISCLOSURE: "on" } as unknown as NodeJS.ProcessEnv), true);
  assert.equal(systemPrompt(true), SYSTEM_PROMPT);
  const off = systemPrompt(false);
  assert.doesNotMatch(off, /LICENSING|getLicensingDisclosure/);
  assert.match(off, /\nGROUNDING:[\s\S]*\nEMERGENCY \([\s\S]*\nBOUNDARIES:\n/, "the rest of the prompt is intact");
});

test("disclosure off: a Copilot/Places question gets no licensing tool call and no licensing line", async () => {
  const before = process.env.LICENSING_DISCLOSURE;
  delete process.env.LICENSING_DISCLOSURE;
  try {
    const res = await createChatResponse({ model: createDemoModel({ chunkDelayMs: 0 }), messages: userMessage(GOLDEN_QUERIES[1]), store: new MockKnowledgeStore() });
    const { message } = await readFinalMessage(res);
    assert.ok(message);
    const ev = extractEvidence(message.parts);
    assert.equal(ev.disclosure, undefined);
    assert.ok(ev.cited.length > 0, "still answers with citations");
    assert.doesNotMatch(ev.text, /Licensing requirements|licen[cs]e/i);
    for (const h of ev.hits.values()) assert.ok(!h.cautions.some((c) => c.includes("getLicensingDisclosure")));
  } finally {
    if (before !== undefined) process.env.LICENSING_DISCLOSURE = before;
  }
});
