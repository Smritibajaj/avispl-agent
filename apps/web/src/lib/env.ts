/** SERVER ONLY. Reports configuration facts, never key values. */
import { DEMO_MODEL_ID } from "./demo-model";

/** Direct Anthropic API id (hyphenated, no date suffix). */
export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

/**
 * Model id conversion between the two id styles (verified against the installed type unions):
 *  - @ai-sdk/anthropic `AnthropicModelId`: "claude-opus-5-5", "claude-sonnet-5-5", "claude-sonnet-4-6"
 *  - @ai-sdk/gateway  `GatewayModelId`:   "anthropic/claude-opus-5.5", "anthropic/claude-sonnet-4.6"
 */
export const toDirectAnthropicId = (id: string): string =>
  id.replace(/^anthropic\//, "").replace(/(\d)\.(\d)(?=$|-)/g, "$1-$2");
export const toGatewayAnthropicId = (id: string): string => {
  return `anthropic/${id.replace(/^anthropic\//, "").replace(/-(\d)-(\d)(?=$|-)/, "-$1.$2")}`;
};

export const anthropicKeyConfigured = (env: NodeJS.ProcessEnv = process.env): boolean => !!env.ANTHROPIC_API_KEY?.trim();
export const gatewayKeyConfigured = (env: NodeJS.ProcessEnv = process.env): boolean =>
  !!(env.AI_GATEWAY_API_KEY?.trim() || env.VERCEL_OIDC_TOKEN?.trim());
/** Any real model credential. */
export const modelKeyConfigured = (env: NodeJS.ProcessEnv = process.env): boolean =>
  anthropicKeyConfigured(env) || gatewayKeyConfigured(env);

export type ModelMode =
  | { kind: "anthropic"; id: string; note?: string }
  | { kind: "gateway"; id: string; note?: string }
  | { kind: "demo"; id: typeof DEMO_MODEL_ID; reason: "CHAT_MODEL=demo" | "dev fallback: no model key" }
  | { kind: "unconfigured"; id: string; note?: string };

/**
 * Selection order:
 *  1. CHAT_MODEL=demo                       -> offline demo model (anywhere, labelled in the UI)
 *  2. ANTHROPIC_API_KEY                     -> direct Anthropic provider (@ai-sdk/anthropic)
 *  3. AI_GATEWAY_API_KEY / VERCEL_OIDC_TOKEN -> Vercel AI Gateway
 *  4. no key, `next dev`                    -> demo model fallback
 *  5. no key, production                    -> unconfigured (/api/chat answers 503)
 * CHAT_MODEL overrides the model id; it is translated between id styles, never swapped for another model.
 * Claude only: a non-Anthropic CHAT_MODEL (e.g. "openai/gpt-5", "ollama:...") resolves to unconfigured.
 */
export function resolveModelMode(env: NodeJS.ProcessEnv = process.env): ModelMode {
  const configured = env.CHAT_MODEL?.trim() ?? "";
  if (configured.toLowerCase() === DEMO_MODEL_ID) return { kind: "demo", id: DEMO_MODEL_ID, reason: "CHAT_MODEL=demo" };
  const notClaude = !!configured && !/^(anthropic\/)?claude-/i.test(configured);
  if (notClaude)
    return { kind: "unconfigured", id: configured, note: `CHAT_MODEL "${configured}" is not a Claude model; this app uses Claude only.` };

  if (anthropicKeyConfigured(env)) {
    if (!configured) return { kind: "anthropic", id: DEFAULT_ANTHROPIC_MODEL };
    const id = toDirectAnthropicId(configured);
    return id === configured
      ? { kind: "anthropic", id }
      : { kind: "anthropic", id, note: `CHAT_MODEL "${configured}" is a gateway-style id; using "${id}" with the direct Anthropic provider.` };
  }
  if (gatewayKeyConfigured(env)) {
    const id = toGatewayAnthropicId(configured || DEFAULT_ANTHROPIC_MODEL);
    return id === configured || !configured
      ? { kind: "gateway", id }
      : { kind: "gateway", id, note: `CHAT_MODEL "${configured}" translated to the gateway id "${id}".` };
  }
  if (env.NODE_ENV === "development") return { kind: "demo", id: DEMO_MODEL_ID, reason: "dev fallback: no model key" };
  return {
    kind: "unconfigured",
    id: configured || DEFAULT_ANTHROPIC_MODEL,
  };
}

export const chatModelId = (): string => resolveModelMode().id;

/** Output cap per model call (thinking counts toward it on Anthropic). Override with CHAT_MAX_OUTPUT_TOKENS. */
export const maxOutputTokens = (env: NodeJS.ProcessEnv = process.env): number => {
  const n = Number(env.CHAT_MAX_OUTPUT_TOKENS);
  return Number.isInteger(n) && n >= 256 && n <= 16000 ? n : 3000;
};

export const MISSING_KEY_MESSAGE =
  "The chat model is not configured: set ANTHROPIC_API_KEY (or AI_GATEWAY_API_KEY) in the repo-root .env and restart the server, " +
  "or set CHAT_MODEL=demo for the offline demo model. The UI, knowledge base and health check work without it.";
