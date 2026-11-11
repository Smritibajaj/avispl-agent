/**
 * When no search works, the agent asks the customer for an email so the team can follow up (see UNAVAILABLE_REPLY).
 * This finds the email they send back, so the chat route can write it to the server log for the team.
 * Owner decision 2026-11-11: the server log is the only place it is kept; nothing is emailed or stored elsewhere.
 */
type Part = { type?: string; text?: string };
type Msg = { role?: string; parts?: Part[] };

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/i;
const textOf = (m: Msg | undefined) => (m?.parts ?? []).filter((p) => p.type === "text" && typeof p.text === "string").map((p) => p.text).join(" ");

export interface ContactRequest {
  email: string;
  /** The customer's question that went unanswered, shortened. */
  question: string;
}

/** A contact request exists when the latest customer message holds an email and the reply before it asked for one. */
export function findContactRequest(messages: readonly unknown[]): ContactRequest | null {
  const msgs = messages as Msg[];
  const last = msgs[msgs.length - 1];
  if (last?.role !== "user") return null;
  const email = textOf(last).match(EMAIL)?.[0];
  if (!email) return null;
  const asked = msgs[msgs.length - 2];
  if (asked?.role !== "assistant" || !/mail/i.test(textOf(asked))) return null;
  const earlier = msgs.slice(0, -2).reverse().find((m) => m.role === "user");
  return { email, question: textOf(earlier).replace(/\s+/g, " ").trim().slice(0, 300) };
}
