"use client";

import { useEffect, useState } from "react";

export type WorkingStage = "thinking" | "searching" | "writing";

const LABEL: Record<WorkingStage, string> = {
  thinking: "Thinking…",
  searching: "Looking through what we've published…",
  writing: "Putting your answer together…",
};

/** After this long without any answer text, say so instead of leaving the customer guessing. */
export const SLOW_AFTER_MS = 12_000;

/** Spinner and a status line shown until the first words of the answer arrive. */
export function Working({ stage }: { stage: WorkingStage }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="working" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span className="working-text">
        {LABEL[stage]}
        {slow && <span className="working-slow"> This is taking a little longer than usual. Thanks for waiting.</span>}
      </span>
    </div>
  );
}
