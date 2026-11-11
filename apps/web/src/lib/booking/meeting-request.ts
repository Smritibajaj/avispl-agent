import { z } from "zod";
import { answersSchema, chatIdSchema } from "./client-profile";

/**
 * A customer's request to meet an AVI-SPL expert, sent from the chat's "Book a meeting" form.
 * Owner decision 2026-11-11: for now the request is written to the server log only (the `[meeting-request]` line);
 * nothing is emailed or stored elsewhere, so someone has to read the logs. Replace `recordMeetingRequest` to change that.
 */
const clean = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim());

export const meetingRequestSchema = z.object({
  name: clean(100).refine((s) => s.length >= 2, "Please enter your name."),
  email: clean(160).refine((s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s), "Please enter a valid work email."),
  company: clean(120).optional().default(""),
  when: clean(200).optional().default(""),
  region: clean(80).optional().default(""),
  notes: clean(600).optional().default(""),
  /** What the customer told the advisor (their own chat messages), shortened by the form. */
  summary: clean(900).optional().default(""),
  /** The chat this request came from and its question and answer pairs: stored as the client profile. */
  chatId: chatIdSchema.optional(),
  answers: answersSchema.optional().default([]),
});
export type MeetingRequest = z.infer<typeof meetingRequestSchema>;

export function parseMeetingRequest(body: unknown): { ok: true; value: MeetingRequest } | { ok: false; error: string } {
  const r = meetingRequestSchema.safeParse(body);
  if (r.success) return { ok: true, value: r.data };
  return { ok: false, error: r.error.issues[0]?.message ?? "Please check the form and try again." };
}

/** One JSON line so a name or note can never split or forge a log line. */
export function recordMeetingRequest(req: MeetingRequest, log: (line: string) => void = console.warn): void {
  const line: Record<string, unknown> = { ...req };
  delete line.answers; // the answers go to the client profile, not this line
  log(`[meeting-request] ${JSON.stringify({ at: new Date().toISOString(), ...line })}`);
}
