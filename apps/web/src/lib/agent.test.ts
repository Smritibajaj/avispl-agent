import { getLicensingDisclosure } from "./disclosure";
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJsonEventStream, readUIMessageStream, simulateReadableStream, type UIMessageChunk } from "ai";
import { z } from "zod";
import { MockLanguageModelV4 } from "ai/test";
import { createChatResponse } from "./agent";
import { MockKnowledgeStore } from "./knowledge/mock-store";
import { extractEvidence } from "./message-evidence";
import type { ChatMessage } from "./tools";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 },
};

type StreamPart = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>["stream"] extends ReadableStream<infer P> ? P : never;

/** Scripted model: step 1 calls three tools, step 2 answers with citations. No network. */
function scriptedModel() {
  let step = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      step++;
      const chunks: StreamPart[] =
        step === 1
          ? [
              { type: "stream-start", warnings: [] },
              { type: "tool-call", toolCallId: "c1", toolName: "searchJourney", input: JSON.stringify({ query: "Copilot Places Teams Rooms", journey_stage: "choose_platform" }) },
              { type: "tool-call", toolCallId: "c2", toolName: "findCaseStudies", input: JSON.stringify({ platform: "microsoft" }) },
              { type: "tool-call", toolCallId: "c3", toolName: "getLicensingDisclosure", input: "{}" },
              { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_use" }, usage },
            ]
          : [
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "t1" },
              { type: "text-delta", id: "t1", delta: "Placeholder answer [S1]. Proof [S3][S99]." },
              { type: "text-end", id: "t1" },
              { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage },
            ];
      return { stream: simulateReadableStream({ chunks }) };
    },
  });
}

test("agent loop: tools run against the mock store and the UI stream carries hits, graph and disclosure", async () => {
  const model = scriptedModel();
  const messages: ChatMessage[] = [{ id: "u1", role: "user", parts: [{ type: "text", text: "Copilot and Places?" }] }];
  const res = await createChatResponse({ model, messages, store: new MockKnowledgeStore() });
  assert.equal(res.status, 200);
  assert.ok(res.body);

  const chunks = parseJsonEventStream({ stream: res.body!, schema: z.custom<UIMessageChunk>((v) => typeof v === "object" && v !== null) });
  const uiChunks = chunks.pipeThrough(
    new TransformStream<{ success: true; value: UIMessageChunk } | { success: false }, UIMessageChunk>({
      transform(r, c) {
        if (r.success) c.enqueue(r.value);
      },
    }),
  );
  let last: ChatMessage | undefined;
  for await (const m of readUIMessageStream<ChatMessage>({ stream: uiChunks })) last = m;
  assert.ok(last, "no assistant message streamed");

  const ev = extractEvidence(last.parts);
  assert.equal(ev.searches, 2, "searchJourney + findCaseStudies");
  assert.ok(ev.hits.size >= 2);
  // Follows the real packages/shared/content/disclosure.txt: pending marker -> pending, approved text -> verbatim.
  const expected = await getLicensingDisclosure();
  assert.deepEqual(ev.disclosure, expected);
  assert.ok(ev.text.includes("[S1]"));
  assert.deepEqual(ev.cited, ["S1", "S3", "S99"]);
  assert.ok(!ev.hits.has("S99"), "invented ref must not resolve");
  // refs unique across the two searches
  const chunkIds = [...ev.hits.values()].map((h) => h.chunkId);
  assert.equal(new Set(chunkIds).size, chunkIds.length);
  assert.equal(ev.backend, "mock");
  // the model received the system prompt via `instructions`
  const first = model.doStreamCalls[0];
  const sys = first?.prompt.find((p) => p.role === "system");
  assert.ok(sys && typeof sys.content === "string" && sys.content.includes("meeting-room expert"));
  assert.equal(model.doStreamCalls.length, 2);
});
