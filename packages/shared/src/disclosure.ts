/**
 * The Microsoft licensing disclosure (Copilot / Places / Teams Premium) must be reproduced WORD FOR WORD.
 * We never write it from memory. The approved text lives in packages/shared/content/disclosure.txt,
 * filled in only from the HSV eBook page AFTER the content owner confirms the exact wording.
 *
 * While the file still contains the marker below, consumers MUST treat the disclosure as pending:
 * do not paraphrase, do not invent, tell the user to check licensing with AVI-SPL instead.
 */
export const DISCLOSURE_PENDING_MARKER = "__PENDING_APPROVAL__";

export const isDisclosurePending = (text: string): boolean =>
  text.trim() === "" || text.includes(DISCLOSURE_PENDING_MARKER);
