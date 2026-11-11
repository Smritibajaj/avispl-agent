"use client";

import { useState } from "react";
import type { ChoiceGroup } from "../lib/chat/choices";

/** Clickable answers for a question the agent just asked. Single = one click sends; multi = pick several, then send. */
export function Choices({ group, onChoose }: { group: ChoiceGroup; onChoose: (answer: string) => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const multi = group.mode === "multi";
  const toggle = (o: string) => setPicked((p) => (p.includes(o) ? p.filter((x) => x !== o) : [...p, o]));
  return (
    <div className="choices" role="group" aria-label={group.label || "Quick answers"}>
      {group.label && <div className="choices-label">{group.label}</div>}
      <div className="choices-row">
        {group.options.map((o) => (
          <button
            key={o}
            type="button"
            className={`choice${picked.includes(o) ? " is-picked" : ""}`}
            aria-pressed={multi ? picked.includes(o) : undefined}
            onClick={() => (multi ? toggle(o) : onChoose(o))}
          >
            {o}
          </button>
        ))}
      </div>
      {multi && (
        <button type="button" className="choices-send" disabled={picked.length === 0} onClick={() => onChoose(picked.join(", "))}>
          Send{picked.length > 0 ? ` (${picked.length})` : ""}
        </button>
      )}
      <div className="choices-hint">Or type your own answer below.</div>
    </div>
  );
}
