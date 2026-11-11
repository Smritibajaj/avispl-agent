import { createChatResponse } from "../../../lib/agent";
import { findContactRequest } from "../../../lib/contact-request";
import { maxOutputTokens, MISSING_KEY_MESSAGE, resolveModelMode } from "../../../lib/env";
import { getStore } from "../../../lib/knowledge";
import { buildModel } from "../../../lib/model";
import { chatRateLimiter, clientIp } from "../../../lib/rate-limit";
import type { ChatMessage } from "../../../lib/tools";

export const runtime = "nodejs";
export const maxDuration = 75; // seconds; the agent itself stops at 60 s

const jsonError = (status: number, code: string, error: string, headers?: Record<string, string>) =>
  Response.json({ code, error }, { status, headers });

let notedModel: string | undefined;

export async function POST(req: Request): Promise<Response> {
  let messages: ChatMessage[];
  try {
    const body = (await req.json()) as { messages?: unknown };
    if (!Array.isArray(body.messages) || body.messages.length === 0) throw new Error("no messages");
    messages = body.messages as ChatMessage[];
  } catch {
    return jsonError(400, "bad_request", "Expected a JSON body with a non-empty `messages` array.");
  }

  const mode = resolveModelMode();
  if (mode.kind === "unconfigured")
    return jsonError(503, "missing_model_key", mode.note ? `${mode.note} ${MISSING_KEY_MESSAGE}` : MISSING_KEY_MESSAGE);
  if ("note" in mode && mode.note && notedModel !== mode.id) {
    notedModel = mode.id;
    console.info(`[chat] ${mode.note}`); // one line per model id; never includes keys
  }

  // Cost guard for paid models. The offline demo model costs nothing and are not limited.
  if (mode.kind === "anthropic" || mode.kind === "gateway") {
    const rl = chatRateLimiter.check(clientIp(req));
    if (!rl.ok)
      return jsonError(429, "rate_limited", `Too many questions in a short time. Please wait about ${Math.ceil(rl.retryAfterSec / 60)} minute(s).`, {
        "retry-after": String(rl.retryAfterSec),
      });
  }

  // The customer left an email after the "our team will reach out" fallback: the server log is where the team finds it.
  const contact = findContactRequest(messages);
  if (contact) console.warn(`[contact-request] email=${contact.email} question=${JSON.stringify(contact.question)}`);

  let store;
  try {
    store = await getStore();
  } catch (e) {
    console.error("knowledge store unavailable:", e instanceof Error ? e.message : e);
    return jsonError(503, "store_unavailable", "The knowledge base is not available right now. Please try again later.");
  }

  const { model, providerOptions } = buildModel(mode);
  return createChatResponse({
    model,
    providerOptions,
    maxOutputTokens: maxOutputTokens(),
    messages,
    store,
    abortSignal: req.signal,
  });
}
