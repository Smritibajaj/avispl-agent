/** SERVER ONLY. Builds the language model and its provider options for a resolved ModelMode. */
import { createAnthropic, type AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { createDemoModel } from "./demo-model";
import type { ModelMode } from "./env";


/**
 * Anthropic call settings for current models (Opus 5.5 / Sonnet 5.5):
 *  - effort "medium" -> sent as `output_config.effort` by @ai-sdk/anthropic 4.0.99
 *  - fallbacks "default" -> server-side refusal fallback; the provider adds the beta header
 *    `server-side-fallback-2026-07-01` itself
 *  - NO `thinking` option (so no `thinking: {type: "disabled"}` / `budget_tokens`), no sampling params,
 *    no forced tool choice. Reasoning is not streamed to the UI (sendReasoning: false in agent.ts).
 */
export const ANTHROPIC_OPTIONS = { effort: "medium", fallbacks: "default" } as const satisfies AnthropicLanguageModelOptions;

export type ProviderOptions = { anthropic: { effort: "medium"; fallbacks: "default" } };

export function buildModel(
  mode: Exclude<ModelMode, { kind: "unconfigured" }>,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: typeof fetch,
): { model: LanguageModel; providerOptions?: ProviderOptions } {
  switch (mode.kind) {
    case "demo":
      return { model: createDemoModel() };
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY?.trim(), ...(fetchImpl ? { fetch: fetchImpl } : {}) });
      return { model: anthropic(mode.id), providerOptions: { anthropic: ANTHROPIC_OPTIONS } };
    }
    case "gateway":
      // Plain string id -> Vercel AI Gateway. Anthropic-specific options are not forwarded on this path.
      return { model: mode.id };
  }
}
