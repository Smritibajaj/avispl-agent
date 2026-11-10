/**
 * Client-safe. Hard rule 2: while the approved Microsoft licensing disclosure is pending, nothing may state,
 * paraphrase or invent licensing wording. Scraped pages contain licensing paragraphs (one of them is the
 * unapproved disclosure candidate itself), so they are withheld from evidence until approval.
 */

/** The only licensing sentence allowed while the disclosure is pending. Deliberately says nothing about what licensing depends on. */
export const PENDING_SENTENCE =
  "Licensing requirements for these Microsoft features are not covered here yet; AVI-SPL will confirm them with you.";

export const WITHHELD_MARK = "[licensing wording withheld until the approved disclosure is available]";

const LICENSING_RE = /\blicen[cs](e|es|ed|ing)\b/i;

/**
 * In every paragraph (line block), cuts from the first sentence that talks about licences to the end of the
 * paragraph and puts WITHHELD_MARK there. The rest of the paragraph goes too because licensing conditions
 * usually continue in the next sentence. Headings and earlier sentences are kept.
 */
export function withholdLicensingText(text: string): string {
  if (!LICENSING_RE.test(text)) return text;
  return text
    .split("\n")
    .map((block) => {
      if (!LICENSING_RE.test(block) || /^\s*#/.test(block)) return block;
      const sentences = block.split(/(?<=[.!?])\s+/);
      const kept = sentences.slice(0, sentences.findIndex((s) => LICENSING_RE.test(s)));
      return [...kept, WITHHELD_MARK].join(" ");
    })
    .join("\n");
}
