import { Fragment, type ReactNode } from "react";

/**
 * Minimal, safe markdown: paragraphs, "-"/"*"/"1." lists, ### headings, **bold** and bare URLs.
 * [S#] citation markers are removed from the visible text. No HTML is ever injected.
 */
interface Props {
  text: string;
}

const URL_RE = /(https?:\/\/[^\s<>()\]]+[^\s<>()\].,;:!?'"])/g;

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  text.split(/(\*\*[^*]+\*\*)/g).forEach((chunk, i) => {
    if (chunk.startsWith("**") && chunk.endsWith("**") && chunk.length > 4) {
      out.push(<strong key={`${keyBase}b${i}`}>{chunk.slice(2, -2)}</strong>);
      return;
    }
    chunk.split(URL_RE).forEach((piece, j) => {
      if (!piece) return;
      if (/^https?:\/\//.test(piece))
        out.push(
          <a key={`${keyBase}u${i}-${j}`} href={piece} target="_blank" rel="noopener noreferrer" className="autolink">
            {piece}
          </a>,
        );
      else out.push(<Fragment key={`${keyBase}t${i}-${j}`}>{piece}</Fragment>);
    });
  });
  return out;
}

/** Citations ([S1], [S2][S4]) are kept in the model's text for grounding checks but are not shown. */
export const stripCitations = (text: string): string => text.replace(/[ \t]*(\[S\d+\?*\])+/g, "");

export function RichText({ text }: Props) {
  const blocks = stripCitations(text).replace(/\r\n/g, "\n").split(/\n{2,}/);
  return (
    <div className="rich">
      {blocks.map((block, bi) => {
        const lines = block.split("\n").filter((l) => l.trim() !== "");
        if (lines.length === 0) return null;
        const isList = lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l));
        if (isList) {
          const ordered = /^\s*\d/.test(lines[0]!);
          const items = lines.map((l, li) => (
            <li key={li}>{inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ""), `b${bi}l${li}`)}</li>
          ));
          return ordered ? <ol key={bi}>{items}</ol> : <ul key={bi}>{items}</ul>;
        }
        const h = /^(#{1,4})\s+(.*)$/.exec(lines[0]!);
        if (h && lines.length === 1)
          return (
            <h4 key={bi} className="rich-h">
              {inline(h[2]!, `b${bi}h`)}
            </h4>
          );
        return (
          <p key={bi}>
            {lines.map((l, li) => (
              <Fragment key={li}>
                {li > 0 && <br />}
                {inline(l.replace(/^#{1,4}\s+/, ""), `b${bi}p${li}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
