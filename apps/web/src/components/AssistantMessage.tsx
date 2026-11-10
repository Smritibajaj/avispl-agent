"use client";

import { useState } from "react";
import { ctaFor } from "../config/cta";
import { PENDING_SENTENCE } from "../lib/licensing-guard";
import type { MessageEvidence } from "../lib/message-evidence";
import { RichText } from "./RichText";
import { SourceCard } from "./SourceCard";

interface Props {
  ev: MessageEvidence;
  streaming: boolean;
}

export function AssistantMessage({ ev, streaming }: Props) {
  const citedHits = ev.cited.map((r) => ev.hits.get(r)).filter((h) => !!h);
  const citedIds = new Set(citedHits.map((h) => h.chunkId));
  const otherHits = [...ev.hits.values()].filter((h) => !citedIds.has(h.chunkId));
  const done = !streaming;
  const cta = ctaFor(ev.dominantStage);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(ev.text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="msg msg-assistant">
      <div className="msg-toolbar">
        {ev.searches > 0 && (
          <span className="chip chip-search" title="Number of knowledge-base searches made for this answer">
            Searched {ev.searches} time{ev.searches === 1 ? "" : "s"}
          </span>
        )}
        {ev.relaxed && (
          <span className="chip chip-warn" title="A search matched nothing with its filters and was broadened">
            Broadened search
          </span>
        )}
        {ev.unavailable && (
          <span className="chip chip-warn" title="A search could not reach the knowledge base">
            Knowledge base unavailable
          </span>
        )}
        {streaming && ev.pendingTools > 0 && <span className="chip muted">Searching…</span>}
      </div>

      {ev.text ? (
        <RichText text={ev.text} hits={ev.hits} />
      ) : (
        streaming && (
          <div className="typing" aria-label="Answer is being prepared">
            <span />
            <span />
            <span />
          </div>
        )
      )}

      {ev.disclosure?.pending && (
        <div className="notice notice-licensing" role="note">
          <strong>Licensing:</strong> the approved Microsoft licensing disclosure is pending approval. {PENDING_SENTENCE}
        </div>
      )}
      {ev.disclosure && !ev.disclosure.pending && (
        <div className="notice notice-licensing" role="note">
          <strong>Licensing disclosure</strong>
          <p className="verbatim">{ev.disclosure.text}</p>
        </div>
      )}

      {citedHits.length > 0 && (
        <section className="sources" aria-label="Cited sources">
          <h3 className="sources-title">Sources</h3>
          <div className="source-grid">
            {citedHits.map((h) => (
              <SourceCard key={h.chunkId} hit={h} cited />
            ))}
          </div>
        </section>
      )}
      {done && otherHits.length > 0 && (
        <details className="sources sources-other" open={citedHits.length === 0}>
          <summary>
            {citedHits.length === 0 ? "Retrieved sources" : "Also retrieved"} ({otherHits.length})
          </summary>
          <div className="source-grid">
            {otherHits.map((h) => (
              <SourceCard key={h.chunkId} hit={h} cited={false} />
            ))}
          </div>
        </details>
      )}

      {done && ev.text && (
        <div className="msg-actions">
          <button type="button" className="action-btn" onClick={copy} aria-label="Copy answer">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 9h11v11H9zM5 15H4V4h11v1" />
            </svg>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}

      {done && ev.text && (
        <aside className="cta">
          <span className="cta-label">Next step</span>
          <a className="cta-btn" href={cta.href} target="_blank" rel="noopener noreferrer">
            {cta.text}
          </a>
        </aside>
      )}
    </div>
  );
}
