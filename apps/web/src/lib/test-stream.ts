// Test helper (not a test file): reads a UI message stream Response into the final assistant message.
import { parseJsonEventStream, readUIMessageStream, type UIMessageChunk } from "ai";
import { z } from "zod";
import type { ChatMessage } from "./tools";

export async function readFinalMessage(res: Response): Promise<{ message: ChatMessage | undefined; textDeltas: number }> {
  const parsed = parseJsonEventStream({ stream: res.body!, schema: z.custom<UIMessageChunk>((v) => typeof v === "object" && v !== null) });
  let textDeltas = 0;
  const chunks = parsed.pipeThrough(
    new TransformStream<{ success: true; value: UIMessageChunk } | { success: false }, UIMessageChunk>({
      transform(r, c) {
        if (!r.success) return;
        if (r.value.type === "text-delta") textDeltas++;
        c.enqueue(r.value);
      },
    }),
  );
  let message: ChatMessage | undefined;
  for await (const m of readUIMessageStream<ChatMessage>({ stream: chunks })) message = m;
  return { message, textDeltas };
}

export const userMessage = (text: string): ChatMessage[] => [{ id: "u1", role: "user", parts: [{ type: "text", text }] }];
