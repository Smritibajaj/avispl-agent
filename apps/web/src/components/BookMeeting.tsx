"use client";

import { useState, type FormEvent } from "react";

const LABEL = "Book a meeting with an AVI-SPL expert";

/** The booking button under a solution. It opens a short form; the request goes to /api/meeting-request. */
export interface BookingContext {
  summary: string;
  chatId?: string;
  answers?: { question: string; answer: string }[];
}

export function BookMeeting({ summary, chatId, answers }: BookingContext) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState("");
  const [f, setF] = useState({ name: "", email: "", company: "", when: "", region: "", notes: "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));

  if (state === "done")
    return (
      <div className="book book-done" role="status">
        Thank you. Our team will reach out to you shortly.
      </div>
    );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setState("sending");
    try {
      const res = await fetch("/api/meeting-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...f, summary, chatId, answers }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(j.error || "Something went wrong. Please try again.");
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setState("idle");
    }
  };

  if (!open)
    return (
      <div className="book">
        <button type="button" className="book-btn" onClick={() => setOpen(true)}>
          {LABEL}
        </button>
      </div>
    );

  return (
    <form className="book book-form" onSubmit={submit}>
      <div className="book-title">{LABEL}</div>
      <label>
        Your name
        <input value={f.name} onChange={set("name")} required maxLength={100} autoComplete="name" />
      </label>
      <label>
        Work email
        <input type="email" value={f.email} onChange={set("email")} required maxLength={160} autoComplete="email" />
      </label>
      <label>
        Company <span className="book-opt">(optional)</span>
        <input value={f.company} onChange={set("company")} maxLength={120} autoComplete="organization" />
      </label>
      <label>
        Best time to talk <span className="book-opt">(optional)</span>
        <input value={f.when} onChange={set("when")} maxLength={200} placeholder="e.g. weekday mornings, next week" />
      </label>
      <label>
        Your region or nearest office <span className="book-opt">(optional)</span>
        <input value={f.region} onChange={set("region")} maxLength={80} placeholder="e.g. Texas, Toronto, London" />
      </label>
      <label>
        Anything we should know <span className="book-opt">(optional)</span>
        <textarea value={f.notes} onChange={set("notes")} maxLength={600} rows={2} />
      </label>
      <p className="book-note">We save these details and your answers in this chat so our expert can prepare for the call.</p>
      {error && (
        <div className="book-error" role="alert">
          {error}
        </div>
      )}
      <div className="book-actions">
        <button type="submit" className="book-btn" disabled={state === "sending"}>
          {state === "sending" ? "Sending..." : "Send request"}
        </button>
        <button type="button" className="book-cancel" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
