/**
 * Quick-reply choices. The agent ends a question with a marker line, for example:
 *   What platform do you use?
 *   [[choices single "Platform": Microsoft Teams | Zoom | Cisco Webex | Google Meet | A mix or not sure]]
 * The UI turns each marker into buttons (single = one click sends, multi = pick several then send).
 * Client-safe: no imports.
 */
export interface ChoiceGroup {
  mode: "single" | "multi";
  label: string;
  options: string[];
}

const MARKER_RE = /\[\[choices[ \t]+(single|multi)(?:[ \t]+"([^"\]]*)")?[ \t]*:([^\]]*)\]\]/g;
const MAX_GROUPS = 3;
const MAX_OPTIONS = 8;

/** Splits the visible text from the choice markers. A marker still being streamed is hidden. */
export function parseChoices(text: string): { text: string; groups: ChoiceGroup[]; book: boolean } {
  const groups: ChoiceGroup[] = [];
  let book = false;
  let visible = text.replace(MARKER_RE, (_m, mode: "single" | "multi", label: string | undefined, list: string) => {
    const options = [...new Set(list.split("|").map((o) => o.trim()).filter(Boolean))].slice(0, MAX_OPTIONS);
    if (options.length >= 2 && groups.length < MAX_GROUPS) groups.push({ mode, label: (label ?? "").trim(), options });
    return "";
  });
  // [[book]] shows the "Book a meeting" button.
  visible = visible.replace(/\[\[book\]\]/gi, () => {
    book = true;
    return "";
  });
  // A marker that has started but not finished (streaming) must not flash as raw text.
  visible = visible.replace(/\[\[(c(h(o(i(c(e(s[^\]]*)?)?)?)?)?)?|b(o(o(k)?)?)?)?$/i, "");
  return { text: visible.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(), groups, book };
}
