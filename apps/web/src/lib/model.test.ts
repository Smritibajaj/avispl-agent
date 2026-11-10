import { test } from "node:test";
import assert from "node:assert/strict";
import { createChatResponse } from "./agent";
import { resolveModelMode, toDirectAnthropicId, toGatewayAnthropicId } from "./env";
import { MockKnowledgeStore } from "./knowledge/mock-store";
import { buildModel } from "./model";
import { RateLimiter } from "./rate-limit";
import { userMessage } from "./test-stream";

const FAKE_KEY = "sk-ant-test-not-a-real-key";
const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;

test("provider selection matrix", () => {
  // demo always wins when asked for explicitly
  assert.equal(resolveModelMode(env({ CHAT_MODEL: "demo", ANTHROPIC_API_KEY: FAKE_KEY, NODE_ENV: "production" })).kind, "demo");
  // Anthropic key -> direct provider, default Opus 5.5
  assert.deepEqual(resolveModelMode(env({ ANTHROPIC_API_KEY: FAKE_KEY, NODE_ENV: "production" })), { kind: "anthropic", id: "claude-opus-5-5" });
  // Anthropic key beats gateway key
  assert.equal(resolveModelMode(env({ ANTHROPIC_API_KEY: FAKE_KEY, AI_GATEWAY_API_KEY: "g" })).kind, "anthropic");
  // CHAT_MODEL override, direct style: used as is
  assert.deepEqual(resolveModelMode(env({ ANTHROPIC_API_KEY: FAKE_KEY, CHAT_MODEL: "claude-sonnet-5-5" })), { kind: "anthropic", id: "claude-sonnet-5-5" });
  // old gateway-style value from .env: translated (not swapped) with a note
  const old = resolveModelMode(env({ ANTHROPIC_API_KEY: FAKE_KEY, CHAT_MODEL: "anthropic/claude-sonnet-4-6" }));
  assert.equal(old.kind, "anthropic");
  assert.equal(old.id, "claude-sonnet-4-6");
  assert.match((old as { note?: string }).note ?? "", /gateway-style id/);
  // gateway only
  assert.deepEqual(resolveModelMode(env({ AI_GATEWAY_API_KEY: "g" })), { kind: "gateway", id: "anthropic/claude-opus-5.5" });
  assert.equal(resolveModelMode(env({ VERCEL_OIDC_TOKEN: "t", CHAT_MODEL: "anthropic/claude-sonnet-4-6" })).id, "anthropic/claude-sonnet-4.6");
  // no keys
  assert.equal(resolveModelMode(env({ NODE_ENV: "development" })).kind, "demo");
  assert.equal(resolveModelMode(env({ NODE_ENV: "production" })).kind, "unconfigured");
  // a non-Anthropic model with only an Anthropic key is not silently swapped
  assert.equal(resolveModelMode(env({ ANTHROPIC_API_KEY: FAKE_KEY, CHAT_MODEL: "openai/gpt-5", NODE_ENV: "production" })).kind, "unconfigured");
  // Claude only: non-Claude ids are refused on every path, never routed
  assert.equal(resolveModelMode(env({ AI_GATEWAY_API_KEY: "g", CHAT_MODEL: "openai/gpt-5" })).kind, "unconfigured");
  assert.equal(resolveModelMode(env({ NODE_ENV: "development", CHAT_MODEL: "ollama:qwen3:4b" })).kind, "unconfigured");
  // the key never appears in what /api/health would report
  const envs: Record<string, string>[] = [{ ANTHROPIC_API_KEY: FAKE_KEY }, { ANTHROPIC_API_KEY: FAKE_KEY, CHAT_MODEL: "anthropic/claude-sonnet-4-6" }];
  for (const e of envs)
    assert.ok(!JSON.stringify(resolveModelMode(env(e))).includes(FAKE_KEY));
});

test("id conversion between direct and gateway styles", () => {
  assert.equal(toDirectAnthropicId("anthropic/claude-opus-5.5"), "claude-opus-5-5");
  assert.equal(toDirectAnthropicId("claude-sonnet-5-5"), "claude-sonnet-5-5");
  assert.equal(toGatewayAnthropicId("claude-opus-5-5"), "anthropic/claude-opus-5.5");
  assert.equal(toGatewayAnthropicId("anthropic/claude-sonnet-4-6"), "anthropic/claude-sonnet-4.6");
  assert.equal(toGatewayAnthropicId("anthropic/claude-opus-5.5"), "anthropic/claude-opus-5.5");
  assert.equal(toGatewayAnthropicId("claude-opus-5"), "anthropic/claude-opus-5");
});

test("real @ai-sdk/anthropic request body: no forbidden params, effort + fallbacks set (fetch captured, no network)", async () => {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    calls.push({ url: String(input), headers, body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "captured in test" } }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  };
  const mode = resolveModelMode(env({ ANTHROPIC_API_KEY: FAKE_KEY }));
  assert.equal(mode.kind, "anthropic");
  if (mode.kind !== "anthropic") return;
  const { model, providerOptions } = buildModel(mode, env({ ANTHROPIC_API_KEY: FAKE_KEY }), fakeFetch);
  const res = await createChatResponse({
    model,
    providerOptions,
    maxOutputTokens: 3000,
    messages: userMessage("What do we need in place to use Copilot and Microsoft Places in our Teams Rooms?"),
    store: new MockKnowledgeStore(),
  });
  await res.text(); // drain: triggers the (captured) model call; the stream carries a friendly error
  assert.ok(calls.length >= 1, "provider was called");
  const { url, headers, body } = calls[0]!;
  assert.match(url, /\/v1\/messages$/);
  assert.equal(headers["x-api-key"], FAKE_KEY); // compared, never printed
  assert.equal(body.model, "claude-opus-5-5");
  assert.equal(body.max_tokens, 3000);
  assert.equal(body.stream, true);
  for (const k of ["temperature", "top_p", "top_k", "thinking"]) assert.ok(!(k in body), `must not send ${k}`);
  const tc = body.tool_choice as { type?: string } | undefined;
  assert.ok(tc === undefined || tc.type === "auto", `tool_choice must be auto/absent, got ${JSON.stringify(tc)}`);
  assert.deepEqual(body.output_config, { effort: "medium" });
  assert.equal(body.fallbacks, "default");
  assert.match(headers["anthropic-beta"] ?? "", /server-side-fallback-2026-07-01/);
  const tools = (body.tools as { name: string }[]).map((t) => t.name).sort();
  assert.deepEqual(tools, ["findCaseStudies", "getLicensingDisclosure", "searchJourney"]);
  assert.ok(typeof body.system === "string" || Array.isArray(body.system), "system prompt sent via instructions");
});

test("rate limiter: 20 per window per key, then 429 with retry-after", () => {
  const rl = new RateLimiter(3, 60_000);
  const t = 1_000_000;
  assert.ok(rl.check("a", t).ok && rl.check("a", t + 1).ok && rl.check("a", t + 2).ok);
  const blocked = rl.check("a", t + 3);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfterSec > 0 && blocked.retryAfterSec <= 60);
  assert.ok(rl.check("b", t + 3).ok, "other IPs unaffected");
  assert.ok(rl.check("a", t + 60_001).ok, "window slides");
});
