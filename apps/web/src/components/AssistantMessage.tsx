"use client";

import { PENDING_SENTENCE } from "../lib/licensing-guard";
import type { MessageEvidence } from "../lib/message-evidence";
import { RichText } from "./RichText";

interface Props {
  ev: MessageEvidence;
  streaming: boolean;
}

export function AssistantMessage({ ev, streaming }: Props) {
  return (
    <div className="msg msg-assistant">
      <div className="msg-toolbar">
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
        <RichText text={ev.text} />
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
    </div>
  );
}
