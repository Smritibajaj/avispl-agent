import type { KnowledgeStore } from "@avispl/shared";

/**
 * STUB written by the integrator so apps/web can import this name while Agent C builds the real adapter.
 * Agent C: replace this file's body, KEEP the exported name and signature.
 */
export interface HydraStoreOptions {
  /** Default https://api.hydradb.com. Point at the local mock (http://localhost:4010) for offline tests. */
  baseUrl?: string;
  apiKey?: string;
  database?: string;
  collection?: string;
}

export function createHydraKnowledgeStore(_opts: HydraStoreOptions = {}): KnowledgeStore {
  throw new Error("createHydraKnowledgeStore is not implemented yet (Agent C owns packages/hydra).");
}
