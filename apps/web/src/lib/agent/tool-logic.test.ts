import { test } from "node:test";
import assert from "node:assert/strict";
import { RefRegistry } from "../chat/refs";

test("a throwing store becomes an 'unavailable' result through the AI SDK tool wrapper", async () => {
  const { createTools } = await import("./tools");
  const broken = { name: "hydra", search: async () => { throw new Error("HYDRADB_API_KEY is not set"); } };
  const tools = createTools(broken, new RefRegistry());
  const out = await tools.searchJourney.execute({ query: "monitoring" }, { toolCallId: "t", messages: [] } as never);
  assert.equal((out as { unavailable?: boolean }).unavailable, true);
  assert.equal((out as { hits: unknown[] }).hits.length, 0);
});
