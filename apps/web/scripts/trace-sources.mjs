#!/usr/bin/env node
/**
 * Shows which knowledge-base source (blog, page, case study, PDF...) each statement in an answer came from.
 *
 *   pnpm --filter @avispl/web trace "your question"
 *   pnpm --filter @avispl/web trace "first message" "your reply to its questions"     (a conversation, turn by turn)
 *   TRACE_URL=https://avispl-meeting-room-advisor.vercel.app pnpm --filter @avispl/web trace "..."   (the live site)
 *   pnpm --filter @avispl/web trace --type blog "..."                                  (only list sources of one type)
 *
 * Default target is the local dev server (http://localhost:3000). Each run calls the real model and HydraDB.
 */
const args = process.argv.slice(2);
let onlyType;
const turns = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--type") onlyType = args[++i];
  else turns.push(args[i]);
}
if (turns.length === 0) {
  console.error('usage: trace [--type blog|page|case_study|pdf|...] "question" ["follow-up" ...]');
  process.exit(1);
}
const base = (process.env.TRACE_URL || "http://localhost:3000").replace(/\/$/, "");

const words = (s) => new Set(s.toLowerCase().replace(/[^a-z0-9äöüß ]+/g, " ").split(/\s+/).filter((w) => w.length > 3));
/** The sentence of the source text that shares the most words with the claim. */
function bestPassage(claim, text) {
  const cw = words(claim);
  // Drop the record header ("## Title ... ## Content <title>") and markdown link targets; keep the body.
  const body = text
    .replace(/^[\s\S]*?## Content\s*\n[^\n]*\n/, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*#]+/g, " ");
  let best = { score: 0, s: "" };
  for (const s of body.split(/\n+|(?<=[.!?])\s+/)) {
    const sw = words(s);
    let n = 0;
    for (const w of cw) if (sw.has(w)) n++;
    if (n > best.score) best = { score: n, s };
  }
  return best.score ? best.s.replace(/\s+/g, " ").trim().slice(0, 240) : "(no closely matching sentence found: read the source)";
}

async function ask(messages) {
  const res = await fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages }) });
  if (!res.ok) throw new Error(`${base}/api/chat answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const hits = new Map();
  const searches = [];
  const inputs = new Map();
  let text = "";
  for (const line of (await res.text()).split("\n")) {
    if (!line.startsWith("data: ") || line.includes("[DONE]")) continue;
    let ev;
    try {
      ev = JSON.parse(line.slice(6));
    } catch {
      continue;
    }
    if (ev.type === "text-delta") text += ev.delta ?? "";
    else if (ev.type === "tool-input-available") inputs.set(ev.toolCallId, ev);
    else if (ev.type === "tool-output-available") {
      const call = inputs.get(ev.toolCallId);
      const out = ev.output ?? {};
      searches.push({ tool: call?.toolName, input: call?.input, backend: out.backend, n: out.hits?.length ?? 0, relaxed: !!out.relaxed, unavailable: !!out.unavailable });
      for (const h of out.hits ?? []) hits.set(h.ref, h);
    }
  }
  return { text, hits, searches };
}

const history = [];
for (const [t, userText] of turns.entries()) {
  history.push({ id: `u${t}`, role: "user", parts: [{ type: "text", text: userText }] });
  const { text, hits, searches } = await ask(history);
  history.push({ id: `a${t}`, role: "assistant", parts: [{ type: "text", text }] });

  console.log(`\n${"=".repeat(100)}\nTURN ${t + 1}  CUSTOMER: ${userText}\n${"=".repeat(100)}`);
  console.log("\nSEARCHES");
  for (const s of searches)
    console.log(`  ${s.tool} ${JSON.stringify(s.input)} -> ${s.n} records from ${s.backend}${s.relaxed ? " (filters dropped)" : ""}${s.unavailable ? " (KNOWLEDGE BASE UNAVAILABLE)" : ""}`);
  if (searches.length === 0) console.log("  none (this reply states no knowledge-base facts)");

  console.log("\nSTATEMENT -> SOURCE");
  const used = new Map();
  let uncited = 0;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\*\*/g, "").trim();
    if (!line) continue;
    const parts = line.split(/((?:\s*\[S\d+\])+)/);
    for (let i = 0; i < parts.length; i += 2) {
      const claim = (parts[i] ?? "").replace(/^[\s.,;:)-]+/, "").trim();
      if (!claim) continue;
      const refs = (parts[i + 1] ?? "").match(/S\d+/g) ?? [];
      if (refs.length === 0) {
        uncited++;
        continue;
      }
      const shown = refs.map((r) => hits.get(r)).filter((h) => h && (!onlyType || h.contentType === onlyType));
      if (onlyType && shown.length === 0) continue;
      console.log(`\n  "${claim}"`);
      for (const r of refs) {
        const h = hits.get(r);
        if (!h) {
          console.log(`     ${r}: NOT IN THE SEARCH RESULTS (invalid citation)`);
          continue;
        }
        if (onlyType && h.contentType !== onlyType) continue;
        used.set(h.sourceUrl, { h, n: (used.get(h.sourceUrl)?.n ?? 0) + 1 });
        console.log(`     ${r}  ${h.contentType.toUpperCase()}  ${h.pageTitle} › ${h.section}${h.pageRange ? ` (p. ${h.pageRange})` : ""}`);
        console.log(`         ${h.sourceUrl}`);
        console.log(`         source says: "${bestPassage(claim, h.text)}"`);
      }
    }
  }

  console.log(`\nSOURCES USED IN THIS ANSWER${onlyType ? ` (type: ${onlyType})` : ""}`);
  const rows = [...used.values()].sort((a, b) => b.n - a.n);
  for (const { h, n } of rows) console.log(`  ${String(n).padStart(2)} statement(s)  ${h.contentType.padEnd(17)} ${h.journeyStage.padEnd(15)} ${h.pageTitle}\n                  ${h.sourceUrl}`);
  if (rows.length === 0) console.log("  none");
  const usedUrls = new Set(rows.map((r) => r.h.sourceUrl));
  const unusedPages = [...new Set([...hits.values()].filter((h) => !usedUrls.has(h.sourceUrl)).map((h) => `${h.contentType}: ${h.pageTitle}`))];
  console.log(`\nRETRIEVED BUT NOT USED: ${unusedPages.length ? unusedPages.join(" | ") : "none"}`);
  console.log(`STATEMENTS WITHOUT A SOURCE (questions, the customer's own facts, advice): ${uncited}`);
}
