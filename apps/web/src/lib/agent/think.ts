/** Client-safe. Removes <think>…</think> blocks (and an unclosed trailing <think>…) from visible text. */
export function stripThink(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>\s*/gi, "")
    .replace(/<think>[\s\S]*$/i, "")
    .replace(/^\s*<\/think>\s*/i, "");
}
