import type {
  ContentType,
  Industry,
  JourneyStage,
  Platform,
  RoomSize,
  Topic,
  Vendor,
} from "./vocab";

/**
 * THE contract between apps/web (consumer) and packages/hydra (provider).
 * apps/web also ships a MockKnowledgeStore so the UI runs with no keys.
 * Change this file only through the integrator (see README ownership table).
 */

/** Filters the MODEL may choose. Hard filters (status=published, meeting_room_relevant=true) are added by the store, never by the model. */
export interface SearchFilters {
  journey_stage?: JourneyStage;
  content_type?: ContentType;
  platforms?: Platform[]; // contains_any
  vendors?: Vendor[]; // contains_any
  topics?: Topic[]; // contains_any
  room_size?: RoomSize; // contains
  industry?: Industry; // equals
}

export interface SearchRequest {
  query: string;
  filters?: SearchFilters;
  /** Literal tokens (product names, SKUs). When present the store also runs a keyword-only query and merges. */
  exactTerms?: string[];
  /** Final number of chunks returned after dedupe + per-source cap. Default 8. */
  maxResults?: number;
}

export interface EvidenceFlags {
  legacyPlatform: boolean;
  metricsAreEstimates: boolean;
  requiresDisclosure: boolean;
}

export interface EvidenceHit {
  /** Stable per-response label the model cites as [S1], [S2]... assigned by the store AFTER merge + dedupe. */
  ref: string;
  chunkId: string;
  sourceId: string;
  text: string;
  /** Record title, e.g. "Symphony › Incident management". */
  title: string;
  sourceUrl: string;
  pageTitle: string;
  section: string;
  pageRange?: string;
  journeyStage: JourneyStage;
  contentType: ContentType;
  lastModified?: string;
  edition?: string;
  csOrganization?: string;
  csRoomsCount?: number;
  flags: EvidenceFlags;
  score: number;
}

/** One relationship from HydraDB's context graph (query_paths[].triplets[]). */
export interface GraphTriplet {
  source: { name: string; type: string };
  relation: string; // canonical_predicate
  target: { name: string; type: string };
  /** Sentence the relation was extracted from, if returned. */
  context?: string;
  /** Chunks (EvidenceHit.chunkId) whose traversal produced this triplet. Click-through target in the UI. */
  chunkIds: string[];
  origin?: "extracted" | "byog" | "declared";
  score?: number;
}

export interface SearchResponse {
  hits: EvidenceHit[];
  graph: GraphTriplet[];
  /** True if the model's filters returned nothing and the store retried with ONLY the hard filters. */
  relaxed: boolean;
  /** Filters actually applied (after relax), for display/debug. */
  appliedFilters: Record<string, unknown>;
  /** Linked-source text from forceful relations (additional_context), if any. */
  linked?: { sourceId: string; title: string; sourceUrl: string; text: string }[];
  latencyMs?: number;
}

export interface KnowledgeStore {
  readonly name: string;
  search(req: SearchRequest): Promise<SearchResponse>;
}
