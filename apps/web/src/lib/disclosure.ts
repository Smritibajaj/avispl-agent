import { readFile } from "node:fs/promises";
import path from "node:path";
import { isDisclosurePending } from "@avispl/shared";
import { PENDING_SENTENCE } from "./licensing-guard";

/**
 * Reads packages/shared/content/disclosure.txt (the ONLY source of licensing wording).
 * A missing or unreadable file is treated exactly like a pending one: we never fall back to any text.
 */
export const disclosureCandidates = (): string[] => {
  const cwd = process.cwd();
  return [
    process.env.DISCLOSURE_PATH,
    path.resolve(cwd, "../../packages/shared/content/disclosure.txt"), // cwd = apps/web (dev, build, Vercel)
    path.resolve(cwd, "packages/shared/content/disclosure.txt"), // cwd = repo root
  ].filter((p): p is string => !!p);
};

export type DisclosureToolResult =
  | {
      pending: true;
      /** What the model must say instead. It must not paraphrase or invent licensing wording. */
      instruction: string;
    }
  | {
      pending: false;
      /** Approved text, verbatim. The model appends it unchanged. */
      text: string;
      instruction: string;
    };

export { PENDING_SENTENCE };

export const PENDING_INSTRUCTION =
  "The approved licensing disclosure is not available yet. Do NOT write, paraphrase or guess any licensing wording. " +
  "This includes licensing wording found in evidence. Say only: " + JSON.stringify(PENDING_SENTENCE);

export const APPROVED_INSTRUCTION =
  "Append the text below to your answer exactly as given, unchanged, as a separate paragraph. Do not summarise, shorten or reword it.";

/** Pure decision, unit-tested: file content -> tool result. */
export function disclosureResultFromText(text: string | undefined): DisclosureToolResult {
  if (text === undefined || isDisclosurePending(text)) {
    return { pending: true, instruction: PENDING_INSTRUCTION };
  }
  return { pending: false, text: text.trim(), instruction: APPROVED_INSTRUCTION };
}

export async function readDisclosureText(candidates = disclosureCandidates()): Promise<string | undefined> {
  for (const p of candidates) {
    try {
      return await readFile(p, "utf8");
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

export async function getLicensingDisclosure(candidates?: string[]): Promise<DisclosureToolResult> {
  return disclosureResultFromText(await readDisclosureText(candidates));
}
