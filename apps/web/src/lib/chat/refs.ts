import type { EvidenceHit } from "@avispl/shared";

/**
 * The store numbers hits S1..Sn per response. The model calls search 2 to 4 times per question, so
 * per-response numbers would collide. The registry renumbers hits per CONVERSATION: the same chunk
 * always gets the same ref, and a new chunk gets the next free number. It is seeded from earlier tool
 * results in the conversation so refs stay stable across turns.
 */
export class RefRegistry {
  private byChunk = new Map<string, string>();
  private next = 1;

  /** Register an existing chunkId -> ref pair (from history). */
  seed(chunkId: string, ref: string): void {
    if (this.byChunk.has(chunkId)) return;
    const n = /^S(\d+)$/.exec(ref);
    if (!n) return;
    this.byChunk.set(chunkId, ref);
    this.next = Math.max(this.next, Number(n[1]) + 1);
  }

  refFor(chunkId: string): string {
    let ref = this.byChunk.get(chunkId);
    if (!ref) {
      ref = `S${this.next++}`;
      this.byChunk.set(chunkId, ref);
    }
    return ref;
  }

  assign<T extends EvidenceHit>(hits: T[]): T[] {
    return hits.map((h) => ({ ...h, ref: this.refFor(h.chunkId) }));
  }

  /** Seed from UI messages: any tool part whose output carries `hits`. */
  seedFromMessages(messages: readonly { parts?: readonly unknown[] }[]): this {
    for (const m of messages) {
      for (const p of m.parts ?? []) {
        const part = p as { type?: unknown; state?: unknown; output?: { hits?: unknown } };
        if (typeof part.type !== "string" || !part.type.startsWith("tool-")) continue;
        if (part.state !== "output-available" || !Array.isArray(part.output?.hits)) continue;
        for (const h of part.output.hits as { chunkId?: unknown; ref?: unknown }[]) {
          if (typeof h.chunkId === "string" && typeof h.ref === "string") this.seed(h.chunkId, h.ref);
        }
      }
    }
    return this;
  }
}
