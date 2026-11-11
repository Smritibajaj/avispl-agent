"use client";

import { PENDING_SENTENCE } from "../lib/licensing/licensing-guard";
import type { MessageEvidence } from "../lib/chat/message-evidence";
import { parseChoices } from "../lib/chat/choices";
import { proofLinks } from "../lib/chat/proof-links";
import { BookMeeting, type BookingContext } from "./BookMeeting";
import { Choices } from "./Choices";
import { RichText } from "./RichText";
import { Working } from "./Working";

interface Props {
  ev: MessageEvidence;
  streaming: boolean;
  /** Set only on the latest answer: its quick-reply buttons send the clicked answer as the user's next message. */
  onChoose?: (answer: string) => void;
  /** What the customer told the advisor, passed along with a meeting request. */
  booking?: BookingContext;
}

export function AssistantMessage({ ev, streaming, onChoose, booking }: Props) {
  const { text, groups, book } = parseChoices(ev.text);
  const links = streaming ? [] : proofLinks(ev.cited, ev.hits);
  return (
    <div className="msg msg-assistant">
      <div className="msg-toolbar">
        {ev.relaxed && (
          <span className="chip chip-warn" title="A search matched nothing with its filters and was broadened">
            Broadened search
          </span>
        )}
      </div>

      {text ? (
        <RichText text={text} />
      ) : (
        streaming && <Working stage={ev.searches === 0 ? "thinking" : ev.pendingTools > 0 ? "searching" : "writing"} />
      )}

      {links.length > 0 && (
        <div className="proof-links">
          <span className="proof-links-title">See it for yourself</span>
          <ul>
            {links.map((l) => (
              <li key={l.url}>
                <a href={l.url} target="_blank" rel="noopener noreferrer">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!streaming && onChoose && book && <BookMeeting summary={booking?.summary ?? ""} chatId={booking?.chatId} answers={booking?.answers} />}
      {!streaming && onChoose && groups.map((g, i) => <Choices key={i} group={g} onChoose={onChoose} />)}

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
