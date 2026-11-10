import type { LanguageModel } from "ai";
import type { JourneyStage } from "@avispl/shared";
import { CTA_DEFAULT } from "../config/cta";
import { disclosureEnabled } from "../config/disclosure";
import type { DisclosureToolResult } from "./disclosure";
import { PENDING_SENTENCE } from "./licensing-guard";
import { FIXTURE_MARK } from "./knowledge/fixtures";
import type { SearchToolOutput, ToolHit } from "./tool-logic";

/**
 * Offline "demo model": a real LanguageModelV4 (no network, no keys, no cost) that drives the SAME
 * tool loop as the real model. It is NOT AI. It never writes content of its own about meeting rooms:
 * every factual line is an excerpt of a retrieved hit, cited with that hit's [S#]. The only fixed
 * sentences are framing (lead line, "nothing found", the mandated pending-licensing sentence, Sources).
 *
 * Steps: (1) call searchJourney with the user's message, plus findCaseStudies for proof-style questions
 * and getLicensingDisclosure when Copilot / Teams Premium / Microsoft Places is mentioned;
 * (2) if a cited hit requires the disclosure and it was not fetched yet, call getLicensingDisclosure;
 * (3) stream an answer assembled from the hits.
 */
export const DEMO_MODEL_ID = "demo";

type LMv4 = Extract<LanguageModel, { specificationVersion: "v4" }>;
type CallOptions = Parameters<LMv4["doStream"]>[0];
type StreamResult = Awaited<ReturnType<LMv4["doStream"]>>;
type StreamPart = StreamResult["stream"] extends ReadableStream<infer P> ? P : never;
type PromptMessage = CallOptions["prompt"][number];

const PROOF_RE = /\b(has avi-?spl done|have you done|done this|case stud(y|ies)|like ours|similar (organi[sz]ation|company|project)|our (sector|industry)|customer (story|stories))\b/i;
const LICENSING_RE = /\b(copilot|teams premium|microsoft places)\b/i;

export const DEMO_PENDING_SENTENCE = PENDING_SENTENCE;

export interface DemoToolResults {
  searches: SearchToolOutput[];
  disclosure?: DisclosureToolResult;
  /** The user's question; used only to choose WHICH retrieved sentences to quote. */
  query?: string;
}

// ---------- pure helpers (unit-tested) ----------

const STAGE_ORDER: JourneyStage[] = ["plan_design", "choose_platform", "deploy", "run_support", "proof"];
export const STAGE_HEADING: Record<JourneyStage, string> = {
  plan_design: "Plan & design",
  choose_platform: "Choose platform",
  deploy: "Deploy",
  run_support: "Run & support",
  proof: "Proof",
};

const STOP = new Set(
  "the and for with what our are how which should about have has this that from into your you can does did done like than then them they their there when where who why will would could need needs use using avi spl avi-spl we us do of to in on a an is it be or".split(" "),
);

/**
 * Plain text of a hit, for quoting: drops the breadcrumb first line ("Page › Section"), markdown
 * heading lines, the demo-fixture marker, link syntax ([text](url) -> text), emphasis markers and
 * list bullets. Every quote the demo model shows is a verbatim substring of THIS text.
 */
export function cleanHitText(text: string, title?: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const first = lines[0]?.trim() ?? "";
  if (first && (first.includes(" › ") || (title && first === title.trim()))) lines.shift();
  return lines
    .filter((l) => !/^\s*#{1,6}\s/.test(l))
    .map((l) =>
      l
        .replace(FIXTURE_MARK, "")
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
        .replace(/\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)/g, "$1")
        .replace(/\*\*|__/g, "")
        .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .join("\n");
}

/** Crude stem: drop common English suffixes, then keep 5 letters ("rooms" ~ "room", "monitored" ~ "monitor"). */
const stem = (w: string) => w.replace(/(ings?|ed|es|s)$/, "").slice(0, 5);
const queryStems = (q: string) =>
  new Set(
    q
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map(stem),
  );

/** Sentences (or bullet/tagline lines without end punctuation) of the clean text, in order. */
export function sentencesOf(clean: string, minLen = 20): string[] {
  const out: string[] = [];
  for (const line of clean.split("\n")) {
    const parts = line.split(/(?<=[.!?])\s+(?=[A-Z0-9"“‘(])/);
    for (const p of parts) {
      const s = p.trim();
      if (s.length >= minLen) out.push(s);
    }
  }
  return out;
}

const overlap = (s: string, stems: Set<string>) => {
  const seen = new Set<string>();
  for (const w of s.toLowerCase().split(/[^a-z0-9]+/)) if (w.length > 2 && stems.has(stem(w))) seen.add(stem(w));
  return seen.size;
};

/** The 1 or 2 sentences that best match the query, in source order. Each is a verbatim substring of cleanHitText. */
export function bestSentences(hit: Pick<ToolHit, "text" | "title">, query: string, max = 2): string[] {
  const sents = sentencesOf(cleanHitText(hit.text, hit.title));
  if (sents.length === 0) return [];
  const stems = queryStems(query);
  const wordy = sents.filter((x) => x.split(/\s+/).length >= 5);
  // A section that is only a short list (e.g. room types): quote the list items themselves, verbatim.
  if (wordy.length === 0) return [sentencesOf(cleanHitText(hit.text, hit.title), 3).slice(0, 6).join("; ")];
  const pool = wordy; // prefer real sentences over short list items
  const scored = pool.map((s) => ({ s, i: sents.indexOf(s), score: overlap(s, stems) }));
  const ranked = [...scored].sort((a, b) => b.score - a.score || a.i - b.i);
  const picked = [ranked[0]!];
  const second = ranked[1];
  if (max > 1 && second && second.score > 0 && picked[0]!.s.length + second.s.length <= 320) picked.push(second);
  return picked.sort((a, b) => a.i - b.i).map((p) => (p.s.length > 300 ? `${p.s.slice(0, p.s.lastIndexOf(" ", 290))}…` : p.s));
}

export const hitRelevance = (hit: Pick<ToolHit, "text" | "title">, query: string) => {
  const stems = queryStems(query);
  return Math.max(0, ...sentencesOf(cleanHitText(hit.text, hit.title)).map((s) => overlap(s, stems)));
};

/**
 * Minimum distinct query terms a quoted hit must share: 2 (or every term for 1-2 term queries).
 * Keyword backends return SOMETHING for almost any query ("design an aquarium" matches room designs);
 * the demo model must say "no evidence" instead of quoting unrelated text.
 */
export const relevanceThreshold = (query: string) => Math.min(2, queryStems(query).size);
export const isRelevant = (hit: Pick<ToolHit, "text" | "title">, query: string) =>
  !query.trim() || hitRelevance(hit, query) >= Math.max(1, relevanceThreshold(query));

/** Backwards-compatible single excerpt (first best sentence). */
export function excerpt(text: string): string {
  return bestSentences({ text, title: "" }, "", 1)[0] ?? "";
}

const cautionTags = (h: ToolHit): string[] => {
  const tags: string[] = [];
  if (h.flags.legacyPlatform) tags.push("older platform generation");
  if (h.flags.metricsAreEstimates) tags.push("figures are estimates");
  if (h.edition === "2021") tags.push("2021 edition, possibly superseded");
  return tags;
};

/** "Section · Page title" (or just the page title when the section is generic or the same). */
export function hitHeading(h: Pick<ToolHit, "section" | "pageTitle" | "title">): string {
  const page = h.pageTitle || h.title.split(" › ")[0] || h.title;
  const section = h.section?.trim();
  if (!section || /^overview$/i.test(section) || section === page) return page;
  return `${section} · ${page}`;
}

/** Picks up to 4 hits: one per source, round-robin across tool calls, preferring hits that match the query. */
export function pickHits(results: DemoToolResults, max = 4): ToolHit[] {
  const q = results.query ?? "";
  const seenChunk = new Set<string>();
  const seenSource = new Set<string>();
  const out: ToolHit[] = [];
  const ordered = [...results.searches].sort((a, b) => Number(a.kind === "case_studies") - Number(b.kind === "case_studies"));
  const queues = ordered.map((s) => s.hits.filter((h) => isRelevant(h, q)));
  while (out.length < max && queues.some((qq) => qq.length)) {
    for (const qq of queues) {
      const h = qq.shift();
      if (!h || seenChunk.has(h.chunkId) || seenSource.has(h.sourceId)) continue;
      seenChunk.add(h.chunkId);
      seenSource.add(h.sourceId);
      out.push(h);
      if (out.length >= max) break;
    }
  }
  return out;
}

const listJoin = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export function composeDemoAnswer(results: DemoToolResults): string {
  if (results.searches.some((s) => s.unavailable) && results.searches.every((s) => s.hits.length === 0)) {
    return `The knowledge base could not be searched right now, so I cannot answer from AVI-SPL content. Next step: ${CTA_DEFAULT.text} (${CTA_DEFAULT.href}).`;
  }
  const query = results.query ?? "";
  const hits = pickHits(results).filter((h) => bestSentences(h, query).length > 0);
  if (hits.length === 0) {
    return (
      "I found no evidence for this in the AVI-SPL meeting-room content I can search, so I cannot answer it. " +
      "I can help with planning, choosing a platform, deploying and running meeting rooms. " +
      `Next step: ${CTA_DEFAULT.text} (${CTA_DEFAULT.href}).`
    );
  }

  const stages = STAGE_ORDER.filter((s) => hits.some((h) => h.journeyStage === s));
  const pages = new Set(hits.map((h) => h.pageTitle || h.sourceId));
  const lines: string[] = [];
  lines.push(
    `I found ${hits.length} relevant passage${hits.length === 1 ? "" : "s"} in ${pages.size} source${pages.size === 1 ? "" : "s"}` +
      (stages.length > 1 ? `, covering ${listJoin(stages.map((s) => STAGE_HEADING[s]))}` : "") +
      ". Below are their own words, quoted, not AI-written.",
  );

  const bullet = (h: ToolHit) => {
    const tags = cautionTags(h);
    const quote = bestSentences(h, query).join(" … ");
    return `- **${hitHeading(h)}**${tags.length ? ` (${tags.join("; ")})` : ""}: "${quote}" [${h.ref}]`;
  };
  if (stages.length > 1) {
    for (const s of stages) {
      lines.push("", `### ${STAGE_HEADING[s]}`, "");
      for (const h of hits.filter((x) => x.journeyStage === s)) lines.push(bullet(h));
    }
  } else {
    lines.push("");
    for (const h of hits) lines.push(bullet(h));
  }

  if (results.searches.some((s) => s.relaxed)) {
    lines.push("", "Note: a search matched nothing with its filters and was broadened, so some sources may be less specific.");
  }
  if (disclosureEnabled() && (hits.some((h) => h.flags.requiresDisclosure) || results.disclosure)) {
    lines.push("");
    if (!results.disclosure || results.disclosure.pending) lines.push(DEMO_PENDING_SENTENCE);
    else lines.push(results.disclosure.text); // verbatim, unchanged
  }
  // Compact sources: the [S#] chips link to each URL; full cards are shown under the answer.
  lines.push("", `Sources: ${hits.map((h) => `[${h.ref}] ${h.pageTitle || h.title}`).join(" · ")}`);
  return lines.join("\n");
}

/** Reads tool results since the last user message from the V4 prompt. */
export function readToolResults(prompt: readonly PromptMessage[]): DemoToolResults & { userText: string; calledDisclosure: boolean } {
  let lastUser = -1;
  prompt.forEach((m, i) => {
    if (m.role === "user") lastUser = i;
  });
  const userMsg = prompt[lastUser];
  const userText =
    userMsg && userMsg.role === "user"
      ? userMsg.content.map((p) => (p.type === "text" ? p.text : "")).join(" ").trim()
      : "";
  const res: DemoToolResults & { userText: string; calledDisclosure: boolean } = { searches: [], userText, calledDisclosure: false };
  for (const m of prompt.slice(lastUser + 1)) {
    if (m.role !== "tool") continue;
    for (const part of m.content) {
      if (part.type !== "tool-result") continue;
      const value = part.output.type === "json" ? (part.output.value as unknown) : undefined;
      if (part.toolName === "getLicensingDisclosure") {
        res.calledDisclosure = true;
        if (value && typeof value === "object" && "pending" in value) res.disclosure = value as DisclosureToolResult;
        else res.disclosure = { pending: true, instruction: "" };
      } else if (part.toolName === "searchJourney" || part.toolName === "findCaseStudies") {
        if (value && typeof value === "object" && Array.isArray((value as SearchToolOutput).hits)) res.searches.push(value as SearchToolOutput);
      }
    }
  }
  return res;
}

export type DemoStep = { kind: "tools"; calls: { toolName: string; input: unknown }[] } | { kind: "text"; text: string };

/** Decides the next step from the prompt. Pure. */
export function nextDemoStep(prompt: readonly PromptMessage[]): DemoStep {
  const r = readToolResults(prompt);
  const last = prompt[prompt.length - 1];
  if (!last || last.role !== "tool") {
    const calls: { toolName: string; input: unknown }[] = [
      { toolName: "searchJourney", input: { query: (r.userText || "meeting rooms").slice(0, 400) } },
    ];
    if (PROOF_RE.test(r.userText)) calls.push({ toolName: "findCaseStudies", input: {} });
    if (disclosureEnabled() && LICENSING_RE.test(r.userText)) calls.push({ toolName: "getLicensingDisclosure", input: {} });
    return { kind: "tools", calls };
  }
  if (disclosureEnabled() && !r.calledDisclosure && pickHits({ ...r, query: r.userText }).some((h) => h.flags.requiresDisclosure)) {
    return { kind: "tools", calls: [{ toolName: "getLicensingDisclosure", input: {} }] };
  }
  return { kind: "text", text: composeDemoAnswer({ ...r, query: r.userText }) };
}

// ---------- the LanguageModelV4 ----------

const usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

export function chunkText(text: string, size = 14): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (ms <= 0 || signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

export function createDemoModel(opts: { chunkDelayMs?: number } = {}): LMv4 {
  const delay = opts.chunkDelayMs ?? 18;
  let callSeq = 0;
  return {
    specificationVersion: "v4",
    provider: "demo",
    modelId: DEMO_MODEL_ID,
    supportedUrls: {},
    async doGenerate() {
      throw new Error("The demo model supports streaming only.");
    },
    async doStream(options: CallOptions): Promise<StreamResult> {
      const step = nextDemoStep(options.prompt);
      const signal = options.abortSignal;
      const parts: StreamPart[] = [{ type: "stream-start", warnings: [] }];
      const stream = new ReadableStream<StreamPart>({
        async start(controller) {
          for (const p of parts) controller.enqueue(p);
          if (step.kind === "tools") {
            await sleep(delay * 4, signal);
            for (const c of step.calls) {
              controller.enqueue({
                type: "tool-call",
                toolCallId: `demo-${++callSeq}`,
                toolName: c.toolName,
                input: JSON.stringify(c.input),
              });
            }
            controller.enqueue({ type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage });
          } else {
            const id = `demo-text-${++callSeq}`;
            controller.enqueue({ type: "text-start", id });
            for (const delta of chunkText(step.text)) {
              if (signal?.aborted) break;
              controller.enqueue({ type: "text-delta", id, delta });
              await sleep(delay, signal);
            }
            controller.enqueue({ type: "text-end", id });
            controller.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage });
          }
          controller.close();
        },
      });
      return { stream };
    },
  };
}
