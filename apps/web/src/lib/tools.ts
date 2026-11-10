import { tool, type InferUITools, type UIMessage } from "ai";
import { z } from "zod";
import type { KnowledgeStore } from "@avispl/shared";
import { disclosureEnabled } from "../config/disclosure";
import { getLicensingDisclosure } from "./disclosure";
import { withholdLicensingText } from "./licensing-guard";
import type { RefRegistry } from "./refs";
import {
  findCaseStudiesInput,
  runFindCaseStudies,
  runSearchJourney,
  searchJourneyInput,
  unavailableOutput,
  type SearchToolOutput,
} from "./tool-logic";

const guarded = async (
  kind: SearchToolOutput["kind"],
  query: string,
  backend: string,
  run: () => Promise<SearchToolOutput>,
): Promise<SearchToolOutput> => {
  try {
    const out = await run();
    // Hard rule 2: until the disclosure is approved, licensing paragraphs never reach the model or the source cards.
    if (disclosureEnabled() && (await getLicensingDisclosure()).pending)
      return {
        ...out,
        hits: out.hits.map((h) => ({ ...h, text: withholdLicensingText(h.text) })),
        graph: out.graph.map((t) => (t.context ? { ...t, context: withholdLicensingText(t.context) } : t)),
      };
    return out;
  } catch (e) {
    // Log the class and message only (store errors never contain keys; see packages/hydra errors).
    console.error(`${kind} failed on backend ${backend}:`, e instanceof Error ? `${e.name}: ${e.message}` : e);
    return unavailableOutput(kind, query, backend);
  }
};

export function createTools(store: KnowledgeStore, registry: RefRegistry) {
  return {
    searchJourney: tool({
      description:
        "Search AVI-SPL meeting-room content. Call it 2 to 4 times per question with different wording and filters " +
        "(e.g. one call per journey stage). Results are numbered [S#]; cite them exactly.",
      inputSchema: searchJourneyInput,
      execute: (input) => guarded("search", input.query, store.name, () => runSearchJourney(store, registry, input)),
    }),
    findCaseStudies: tool({
      description:
        "Find AVI-SPL customer case studies (journey stage 'proof'). Use when the user asks whether AVI-SPL has done this, " +
        "or names their sector. Sorted by number of rooms, older-platform stories last.",
      inputSchema: findCaseStudiesInput,
      execute: (input) =>
        guarded("case_studies", "case studies", store.name, () => runFindCaseStudies(store, registry, input)),
    }),
    getLicensingDisclosure: tool({
      description:
        "Returns the approved Microsoft licensing disclosure, or {pending:true}. Call whenever Copilot, Teams Premium " +
        "or Microsoft Places is mentioned. Never write licensing wording yourself.",
      inputSchema: z.object({}),
      execute: () => getLicensingDisclosure(),
    }),
  };
}

export type ChatTools = InferUITools<ReturnType<typeof createTools>>;
export type ChatMessage = UIMessage<never, never, ChatTools>;
