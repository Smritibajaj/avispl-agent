import { createRequire } from "node:module";

/**
 * Keyword index for the mock. SQLite FTS5 via node:sqlite (Node 22) when available, else a small
 * in-memory BM25. Either way it is keyword matching only: the mock proves plumbing, never relevance.
 */
export interface SearchIndex {
  readonly kind: "fts5" | "bm25";
  add(uuid: string, text: string): void;
  remove(uuid: string): void;
  /** Ranked matches (best first) among chunks accepted by `allowed`. Scores normalised to (0, 1]. */
  search(query: string, limit: number, allowed: (uuid: string) => boolean): { uuid: string; score: number }[];
}

export const tokenize = (s: string): string[] => (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length > 1);

class Bm25Index implements SearchIndex {
  readonly kind = "bm25" as const;
  private docs = new Map<string, Map<string, number>>();
  private lens = new Map<string, number>();
  add(uuid: string, text: string) {
    const tf = new Map<string, number>();
    const toks = tokenize(text);
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    this.docs.set(uuid, tf);
    this.lens.set(uuid, toks.length);
  }
  remove(uuid: string) {
    this.docs.delete(uuid);
    this.lens.delete(uuid);
  }
  search(query: string, limit: number, allowed: (uuid: string) => boolean) {
    const q = [...new Set(tokenize(query))];
    if (!q.length || !this.docs.size) return [];
    const N = this.docs.size;
    const avg = [...this.lens.values()].reduce((a, b) => a + b, 0) / N || 1;
    const df = new Map<string, number>();
    for (const t of q) {
      let n = 0;
      for (const tf of this.docs.values()) if (tf.has(t)) n++;
      df.set(t, n);
    }
    const k1 = 1.2;
    const b = 0.75;
    const out: { uuid: string; score: number }[] = [];
    for (const [uuid, tf] of this.docs) {
      if (!allowed(uuid)) continue;
      let s = 0;
      for (const t of q) {
        const f = tf.get(t);
        if (!f) continue;
        const n = df.get(t) ?? 0;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        s += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * (this.lens.get(uuid) ?? 0)) / avg));
      }
      if (s > 0) out.push({ uuid, score: s });
    }
    out.sort((a, b2) => b2.score - a.score);
    return normalise(out.slice(0, limit));
  }
}

class Fts5Index implements SearchIndex {
  readonly kind = "fts5" as const;
  // node:sqlite types: kept loose so the mock compiles regardless of @types/node version.
  private db: any;
  private rowOf = new Map<string, number | bigint>();
  constructor(DatabaseSync: any) {
    this.db = new DatabaseSync(":memory:");
    this.db.exec("CREATE VIRTUAL TABLE chunks USING fts5(uuid UNINDEXED, body, tokenize = 'unicode61')");
  }
  add(uuid: string, text: string) {
    this.remove(uuid);
    const r = this.db.prepare("INSERT INTO chunks (uuid, body) VALUES (?, ?)").run(uuid, text);
    this.rowOf.set(uuid, r.lastInsertRowid);
  }
  remove(uuid: string) {
    const row = this.rowOf.get(uuid);
    if (row === undefined) return;
    this.db.prepare("DELETE FROM chunks WHERE rowid = ?").run(row);
    this.rowOf.delete(uuid);
  }
  search(query: string, limit: number, allowed: (uuid: string) => boolean) {
    const toks = [...new Set(tokenize(query))];
    if (!toks.length) return [];
    const match = toks.map((t) => `"${t.replace(/"/g, '""')}"`).join(" OR ");
    const rows = this.db
      .prepare("SELECT uuid, bm25(chunks) AS s FROM chunks WHERE chunks MATCH ? ORDER BY s")
      .all(match) as { uuid: string; s: number }[];
    const out = rows.filter((r) => allowed(r.uuid)).slice(0, limit).map((r) => ({ uuid: r.uuid, score: -r.s }));
    return normalise(out);
  }
}

function normalise(list: { uuid: string; score: number }[]) {
  const max = Math.max(...list.map((x) => x.score), 1e-9);
  return list.map((x) => ({ uuid: x.uuid, score: Math.round(Math.max(0.01, x.score / max) * 1000) / 1000 }));
}

/** `prefer: "bm25"` forces the fallback (tests exercise both). */
export function createSearchIndex(prefer: "auto" | "fts5" | "bm25" = "auto"): SearchIndex {
  if (prefer !== "bm25") {
    try {
      const req = createRequire(import.meta.url);
      const emit = process.emitWarning;
      // node:sqlite prints an ExperimentalWarning on load; silence only that one.
      process.emitWarning = ((w: string | Error, ...rest: unknown[]) => {
        if (String(typeof w === "string" ? w : w.message).includes("SQLite")) return;
        return (emit as (...a: unknown[]) => void).call(process, w, ...rest);
      }) as typeof process.emitWarning;
      let mod: any;
      try {
        mod = req("node:sqlite");
      } finally {
        process.emitWarning = emit;
      }
      return new Fts5Index(mod.DatabaseSync);
    } catch (e) {
      if (prefer === "fts5") throw e;
    }
  }
  return new Bm25Index();
}
