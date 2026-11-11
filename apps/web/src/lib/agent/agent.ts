import { convertToModelMessages, isStepCount, smoothStream, streamText, type LanguageModel } from "ai";
import type { KnowledgeStore } from "@avispl/shared";
import { RefRegistry } from "../chat/refs";
import { disclosureEnabled } from "../../config/disclosure";
import { systemPrompt } from "./system-prompt";
import type { ProviderOptions } from "./model";
import { createTools, type ChatMessage } from "./tools";

export const MAX_STEPS = 6;
export const TOTAL_TIMEOUT_MS = 60_000;
export const DEFAULT_MAX_OUTPUT_TOKENS = 3000;
/**
 * Pause between words sent to the browser. After a tool result, the Anthropic API holds back the first seconds of
 * Sonnet/Opus output and then releases it in one burst (measured 2026-11-11: about 300 words within 5 ms), so
 * without pacing the whole answer appears at once. 14 ms a word shows a 300-word answer in about 4 s.
 */
export const WORD_DELAY_MS = 14;

/** Maps provider errors to a message safe to show in the UI (never echoes keys or raw payloads). */
export function friendlyStreamError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  if (/credit balance is too low|insufficient credit|billing/i.test(msg))
    return "The AI model account has run out of credits, so this question could not be answered. The site owner needs to top up the Anthropic account (or switch to the demo model).";
  if (/api key|unauthori[sz]ed|authentication|401|403/i.test(msg))
    return "The chat model rejected the credentials. Check ANTHROPIC_API_KEY (or AI_GATEWAY_API_KEY).";
  if (/rate limit|429|overloaded|529/i.test(msg)) return "The model is busy right now. Please try again in a minute.";
  if (/timeout|timed out|aborted/i.test(msg)) return "The answer took too long and was stopped. Please try again.";
  return "Something went wrong while answering. Please try again.";
}

/** The agent: one streamText tool loop over the knowledge store. Model is injectable for tests. */
export async function createChatResponse(opts: {
  model: LanguageModel;
  messages: ChatMessage[];
  store: KnowledgeStore;
  abortSignal?: AbortSignal;
  providerOptions?: ProviderOptions;
  maxOutputTokens?: number;
  /** Total timeout for the whole answer (default 60 s). */
  totalTimeoutMs?: number;
  /** Pause between words (default WORD_DELAY_MS); null sends text as it arrives (tests). */
  wordDelayMs?: number | null;
}): Promise<Response> {
  const registry = new RefRegistry().seedFromMessages(opts.messages);
  const tools = createTools(opts.store, registry);
  const withDisclosure = disclosureEnabled();

  const result = streamText({
    model: opts.model,
    instructions: systemPrompt(withDisclosure),
    messages: await convertToModelMessages(opts.messages, { tools, ignoreIncompleteToolCalls: true }),
    tools,
    // Disclosure switched off: the model never sees the licensing tool.
    ...(withDisclosure ? {} : { activeTools: ["searchJourney", "findCaseStudies"] as const }),
    // No toolChoice (= provider default "auto"), no temperature/topP/topK: current Claude models reject
    // forced tool choice and non-default sampling parameters.
    stopWhen: isStepCount(MAX_STEPS),
    experimental_transform: smoothStream({ delayInMs: opts.wordDelayMs === undefined ? WORD_DELAY_MS : opts.wordDelayMs, chunking: "word" }),
    maxOutputTokens: opts.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    ...(opts.providerOptions ? { providerOptions: opts.providerOptions } : {}),
    timeout: { totalMs: opts.totalTimeoutMs ?? TOTAL_TIMEOUT_MS },
    abortSignal: opts.abortSignal,
    onError: ({ error }) => {
      console.error("chat stream error:", error instanceof Error ? error.message : error);
    },
  });

  return result.toUIMessageStreamResponse({
    originalMessages: opts.messages,
    sendReasoning: false, // never stream thinking to the UI
    onError: friendlyStreamError,
  });
}
