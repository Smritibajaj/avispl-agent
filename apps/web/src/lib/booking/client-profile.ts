import { z } from "zod";
import { parseChoices } from "../chat/choices";

/**
 * What a customer told the advisor in one chat, as question and answer pairs. Client-safe (no server imports).
 * Saved by /api/client-profile when the advisor delivers its plan, and by /api/meeting-request with the contact form.
 */
const clean = (max: number) =>
  z
    .string()
    .max(max * 4)
    .transform((s) => s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max));

export const answersSchema = z.array(z.object({ question: clean(200), answer: clean(600) })).max(60);
export const chatIdSchema = z.string().regex(/^[A-Za-z0-9_-]{4,80}$/);
export const clientProfileSchema = z.object({ chatId: chatIdSchema, answers: answersSchema.min(1) });

export type IntakeAnswer = z.infer<typeof answersSchema>[number];

/** The question an assistant message ended on: the label of its last choices marker, else its last line ending in "?". */
export function questionOf(assistantText: string): string {
  const { text, groups } = parseChoices(assistantText);
  const label = groups[groups.length - 1]?.label?.trim();
  if (label) return label;
  const lines = text.replace(/\[S\d+\]/g, "").split("\n").map((l) => l.replace(/\(\d+ of \d+\)\s*$/, "").trim());
  return [...lines].reverse().find((l) => l.endsWith("?"))?.slice(0, 200) ?? "";
}

/** Pair every customer message with the question it answers (empty question = their own opening request). */
export function intakeAnswers(messages: readonly { role: string; text: string }[]): IntakeAnswer[] {
  const out: IntakeAnswer[] = [];
  let question = "";
  for (const m of messages) {
    if (m.role === "assistant") question = questionOf(m.text);
    else if (m.role === "user" && m.text.trim()) {
      out.push({ question, answer: m.text.replace(/\s+/g, " ").trim().slice(0, 600) });
      question = "";
    }
  }
  return out.slice(0, 60);
}
