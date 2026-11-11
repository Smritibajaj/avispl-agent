"use client";

import { PENDING_SENTENCE } from "../lib/licensing-guard";
import type { MessageEvidence } from "../lib/message-evidence";
import { RichText } from "./RichText";
import { Working } from "./Working";

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
      </div>

      {ev.text ? (
        <RichText text={ev.text} />
      ) : (
        streaming && <Working stage={ev.searches === 0 ? "thinking" : ev.pendingTools > 0 ? "searching" : "writing"} />
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
