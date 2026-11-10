import { Fragment, type ReactNode } from "react";
import { parseCitations } from "../lib/citations";
import type { ToolHit } from "../lib/tool-logic";

/**
 * Minimal, safe markdown: paragraphs, "-"/"*"/"1." lists, ### headings, **bold**, bare URLs,
 * and [S#] citations turned into links to the cited source. No HTML is ever injected.
 */
interface Props {
  text: string;
  hits: Map<string, ToolHit>;
  onCite?: (ref: string) => void;
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

function withCitations(line: string, hits: Map<string, ToolHit>, keyBase: string, onCite?: (ref: string) => void) {
  return parseCitations(line).map((seg, i) => {
    if (seg.type === "text") return <Fragment key={`${keyBase}-${i}`}>{inline(seg.value, `${keyBase}-${i}`)}</Fragment>;
    return (
      <span key={`${keyBase}-${i}`} className="cites">
        {seg.refs.map((ref) => {
          const h = hits.get(ref);
          if (!h)
            return (
              <span key={ref} className="cite cite-unknown" title="This reference does not match any retrieved source">
                {ref}?
              </span>
            );
          return (
            <a
              key={ref}
              className="cite"
              href={h.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={`${h.title}${h.pageRange ? ` (pp. ${h.pageRange})` : ""}`}
              onMouseEnter={() => onCite?.(ref)}
              onFocus={() => onCite?.(ref)}
            >
              {ref}
            </a>
          );
        })}
      </span>
    );
  });
}

export function RichText({ text, hits, onCite }: Props) {
  const blocks = text.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return (
    <div className="rich">
      {blocks.map((block, bi) => {
        const lines = block.split("\n").filter((l) => l.trim() !== "");
        if (lines.length === 0) return null;
        const isList = lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l));
        if (isList) {
          const ordered = /^\s*\d/.test(lines[0]!);
          const items = lines.map((l, li) => (
            <li key={li}>{withCitations(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ""), hits, `b${bi}l${li}`, onCite)}</li>
          ));
          return ordered ? <ol key={bi}>{items}</ol> : <ul key={bi}>{items}</ul>;
        }
        const h = /^(#{1,4})\s+(.*)$/.exec(lines[0]!);
        if (h && lines.length === 1)
          return (
            <h4 key={bi} className="rich-h">
              {withCitations(h[2]!, hits, `b${bi}h`, onCite)}
            </h4>
          );
        return (
          <p key={bi}>
            {lines.map((l, li) => (
              <Fragment key={li}>
                {li > 0 && <br />}
                {withCitations(l.replace(/^#{1,4}\s+/, ""), hits, `b${bi}p${li}`, onCite)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
