import { randomUUID } from "node:crypto";
import { createSearchIndex, type SearchIndex } from "./search-index";

/**
 * HydraDB-compatible SUBSET, for plumbing tests only. Self-contained (no workspace imports) so the
 * Docker image only needs this folder. Rules mirror docs.hydradb.com v2 (checked 2026-11-10); where the
 * docs are silent the mock is STRICTER than we expect the real API to be, so our bugs surface here.
 * It never claims relevance or graph quality: graph_context is always empty and meta.mock is true.
 */

export interface EngineOptions {
  /** ms after POST /databases until infra.ready_for_ingestion is true. */
  readyAfterMs?: number;
  /** ms per indexing step: queued -> processing -> graph_creation -> completed. */
  stepMs?: number;
  search?: "auto" | "fts5" | "bm25";
  /**
   * Demo graph (opt-in, default "none"). "metadata": triplets derived ONLY from each returned chunk's declared
   * metadata (never from free text), so the graph panel can be exercised offline. Not HydraDB extraction.
   */
  graph?: "none" | "metadata";
  now?: () => number;
}

export interface MockResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

interface FieldDef {
  name: string;
  data_type: string;
  max_length?: number;
  enable_dense_embedding?: boolean;
  enable_sparse_embedding?: boolean;
  enable_match?: boolean;
}

interface Database {
  name: string;
  schema: FieldDef[];
  createdAt: number;
}

interface Source {
  id: string;
  title: string;
  url?: string;
  kind: string;
  body: string;
  metadata: Record<string, unknown>;
  additional: Record<string, unknown>;
  relationIds: string[];
  timestamp?: string;
  ingestedAt: number;
  chunks: string[];
}

interface ChunkRec {
  uuid: string;
  sourceKey: string;
  text: string;
}

const METADATA_MAX = 16 * 1024;
const ADDITIONAL_MAX = 1024;
const FILTER_MAX = 64 * 1024;
const DB_RE = /^[a-z0-9_-]{1,255}$/;
const FIELD_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
const TYPES = new Set(["VARCHAR", "BOOL", "INT8", "INT16", "INT32", "INT64", "FLOAT", "DOUBLE", "JSON"]);
const TYPE_ALIAS: Record<string, string> = { string: "VARCHAR", boolean: "BOOL", integer: "INT64", float: "DOUBLE", object: "JSON" };
// source_id/chunk_id/metadata: documented examples. source_url: probe-verified 2026-11-10 (real API returns
// 400 "invalid database creation request" for it). "id": mock-only guess, unverified.
const RESERVED = new Set(["source_id", "chunk_id", "metadata", "id", "source_url"]);
const ITEM_KEYS = new Set([
  "id", "database", "collection", "title", "url", "timestamp", "kind", "provider", "external_id", "fields",
  "metadata", "additional_metadata", "relations", "app_relations", "acl", "attachments", "comments",
]);
const KINDS = new Set(["email", "message", "ticket", "knowledge_base", "comment", "meeting", "custom"]);
const OPS = new Set(["equals", "contains", "contains_any"]);
const enc = new TextEncoder();
const bytes = (v: unknown) => enc.encode(JSON.stringify(v)).length;

const INT_RANGE: Record<string, [number, number]> = {
  INT8: [-128, 127],
  INT16: [-32768, 32767],
  INT32: [-2147483648, 2147483647],
  INT64: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
};

class ApiErr extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly param?: string, readonly headers?: Record<string, string>) {
    super(message);
  }
}

const deepEqual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export class MockEngine {
  private dbs = new Map<string, Database>();
  private sources = new Map<string, Source>(); // key: db/collection/id
  private chunks = new Map<string, ChunkRec>();
  private index: SearchIndex;
  private readyAfterMs: number;
  private stepMs: number;
  private now: () => number;
  private graphMode: "none" | "metadata";

  constructor(opts: EngineOptions = {}) {
    this.readyAfterMs = opts.readyAfterMs ?? 500;
    this.stepMs = opts.stepMs ?? 300;
    this.now = opts.now ?? Date.now;
    this.graphMode = opts.graph ?? "none";
    this.index = createSearchIndex(opts.search ?? "auto");
  }

  get searchKind() {
    return this.index.kind;
  }

  // ---------- envelope ----------
  private ok(data: unknown, status = 200, extraMeta: Record<string, unknown> = {}): MockResponse {
    return { status, body: { success: true, data, error: null, meta: { request_id: randomUUID(), latency_ms: 0, mock: true, ...extraMeta } } };
  }
  private fail(e: ApiErr): MockResponse {
    return {
      status: e.status,
      headers: e.headers,
      body: {
        success: false,
        data: null,
        error: { code: e.code, message: e.message, ...(e.param ? { param: e.param } : {}) },
        meta: { request_id: randomUUID(), latency_ms: 0, mock: true },
      },
    };
  }
  private wrap(fn: () => MockResponse): MockResponse {
    try {
      return fn();
    } catch (e) {
      if (e instanceof ApiErr) return this.fail(e);
      return this.fail(new ApiErr(500, "INTERNAL_ERROR", e instanceof Error ? e.message : String(e)));
    }
  }

  private db(name: unknown, { requireReady }: { requireReady: boolean }): Database {
    if (typeof name !== "string" || !name) throw new ApiErr(400, "INVALID_INPUT", "database is required", "database");
    const d = this.dbs.get(name);
    if (!d) throw new ApiErr(404, "DATABASE_NOT_FOUND", "Database not found", "database");
    if (requireReady && !this.isReady(d)) throw new ApiErr(422, "TENANT_INFRA_NOT_READY", "database is still provisioning");
    return d;
  }
  private isReady(d: Database) {
    return this.now() - d.createdAt >= this.readyAfterMs;
  }
  private key(db: string, collection: string | undefined, id: string) {
    return `${db}/${collection || "default"}/${id}`;
  }
  private statusOf(s: Source): string {
    const dt = this.now() - s.ingestedAt;
    if (dt < this.stepMs) return "queued";
    if (dt < 2 * this.stepMs) return "processing";
    if (dt < 3 * this.stepMs) return "graph_creation";
    return "completed";
  }

  // ---------- POST /databases ----------
  createDatabase(body: unknown): MockResponse {
    return this.wrap(() => {
      if (!isObj(body)) throw new ApiErr(400, "INVALID_INPUT", "body must be a JSON object");
      const name = body.database ?? body.tenant_id;
      if (typeof name !== "string" || !DB_RE.test(name))
        throw new ApiErr(400, "INVALID_INPUT", "database must be lowercase letters, digits, - and _ (max 255)", "database");
      if (this.dbs.has(name)) throw new ApiErr(409, "DATABASE_ALREADY_EXISTS", "Database ID already exists", "database");
      const rawSchema = body.database_metadata_schema ?? body.tenant_metadata_schema ?? [];
      if (!Array.isArray(rawSchema)) throw new ApiErr(400, "INVALID_INPUT", "database_metadata_schema must be an array");
      const schema: FieldDef[] = [];
      const seen = new Set<string>();
      let flags = 0;
      for (const f of rawSchema) {
        if (!isObj(f) || typeof f.name !== "string") throw new ApiErr(400, "INVALID_INPUT", "schema field needs a name");
        for (const k of Object.keys(f))
          if (!["name", "data_type", "max_length", "enable_dense_embedding", "enable_sparse_embedding", "enable_match"].includes(k))
            throw new ApiErr(400, "INVALID_INPUT", `unknown schema option "${k}" on ${f.name}`);
        if (!FIELD_RE.test(f.name) || RESERVED.has(f.name.toLowerCase())) throw new ApiErr(400, "INVALID_INPUT", `invalid field name ${f.name}`);
        if (seen.has(f.name.toLowerCase())) throw new ApiErr(400, "INVALID_INPUT", `duplicate field ${f.name}`);
        seen.add(f.name.toLowerCase());
        const dtRaw = f.data_type === undefined ? "VARCHAR" : String(f.data_type);
        const dt = TYPE_ALIAS[dtRaw] ?? dtRaw.toUpperCase();
        if (dt === "ARRAY" || !TYPES.has(dt)) throw new ApiErr(400, "INVALID_INPUT", `data_type ${dtRaw} not supported on ${f.name}`);
        const dense = f.enable_dense_embedding === true;
        const sparse = f.enable_sparse_embedding === true;
        if ((dense || sparse) && dt !== "VARCHAR") throw new ApiErr(400, "INVALID_INPUT", `embedding flags only valid on VARCHAR (${f.name})`);
        flags += (dense ? 1 : 0) + (sparse ? 1 : 0);
        const ml = f.max_length === undefined ? undefined : Number(f.max_length);
        if (ml !== undefined && (!Number.isInteger(ml) || ml < 1 || ml > 65535)) throw new ApiErr(400, "INVALID_INPUT", `max_length out of range on ${f.name}`);
        schema.push({ name: f.name, data_type: dt, max_length: dt === "VARCHAR" ? (ml ?? 1024) : undefined, enable_dense_embedding: dense, enable_sparse_embedding: sparse, enable_match: f.enable_match === true });
      }
      if (schema.length > 32) throw new ApiErr(400, "INVALID_INPUT", `at most 32 metadata fields (got ${schema.length})`);
      if (flags > 6) throw new ApiErr(400, "INVALID_INPUT", `at most 6 embedding-enabled fields (got ${flags})`);
      this.dbs.set(name, { name, schema, createdAt: this.now() });
      return this.ok({ status: "accepted", database: name, message: "Database creation started in the background. Use GET /databases/status?database=... to check progress." });
    });
  }

  // ---------- GET /databases/status ----------
  databaseStatus(q: URLSearchParams): MockResponse {
    return this.wrap(() => {
      const d = this.db(q.get("database"), { requireReady: false });
      const ready = this.isReady(d);
      return this.ok({
        database: d.name,
        message: ready ? "ready" : "provisioning",
        infra: { scheduler_status: ready, graph_status: ready, vectorstore_status: { knowledge: ready, memories: ready }, ready_for_ingestion: ready },
      });
    });
  }

  metadataSchema(dbName: string): MockResponse {
    return this.wrap(() => {
      const d = this.db(dbName, { requireReady: false });
      return this.ok({ database: d.name, database_metadata_schema: d.schema });
    });
  }

  // ---------- POST /context/ingest ----------
  ingest(form: Map<string, string | { file: true }>): MockResponse {
    return this.wrap(() => {
      const d = this.db(form.get("database") ?? form.get("tenant_id"), { requireReady: true });
      const type = form.get("type") ?? "knowledge";
      if (type !== "knowledge") throw new ApiErr(400, "INVALID_INPUT", "mock supports type=knowledge only", "type");
      if (form.has("documents") || form.has("document_metadata")) throw new ApiErr(400, "INVALID_INPUT", "mock supports app_knowledge only (no documents)", "documents");
      if (form.has("memories")) throw new ApiErr(400, "INVALID_INPUT", "memories need type=memory (not supported by the mock)", "memories");
      const collection = (form.get("collection") as string | undefined) || "default";
      const upsertRaw = (form.get("upsert") as string | undefined) ?? "true";
      if (!["true", "false", "1", "0"].includes(upsertRaw)) throw new ApiErr(400, "INVALID_INPUT", "upsert must be true, false, 1 or 0", "upsert");
      const upsert = upsertRaw === "true" || upsertRaw === "1";
      const raw = form.get("app_knowledge");
      if (typeof raw !== "string" || !raw) throw new ApiErr(400, "INVALID_INPUT", "app_knowledge is required", "app_knowledge");
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new ApiErr(400, "INVALID_INPUT", "app_knowledge must be a JSON array or object", "app_knowledge");
      }
      const items = Array.isArray(parsed) ? parsed : [parsed];
      if (!items.length) throw new ApiErr(400, "INVALID_INPUT", "app_knowledge is empty", "app_knowledge");

      // Whole-request validation first (size caps fail the WHOLE request per docs).
      const declared = new Map(d.schema.map((f) => [f.name, f]));
      items.forEach((it, i) => {
        const where = `app_knowledge[${i}]`;
        if (!isObj(it)) throw new ApiErr(400, "INVALID_INPUT", `${where} must be an object`);
        for (const k of Object.keys(it)) if (!ITEM_KEYS.has(k)) throw new ApiErr(400, "INVALID_INPUT", `${where}: unknown field "${k}"`, k);
        if (typeof it.id !== "string" || !it.id) throw new ApiErr(400, "INVALID_INPUT", `${where}.id is required`, "id");
        if (it.id.includes(",")) throw new ApiErr(400, "INVALID_INPUT", `${where}.id must not contain commas`, "id");
        if (it.database !== undefined && it.database !== d.name) throw new ApiErr(400, "INVALID_INPUT", `${where}.database does not match the request`, "database");
        if (it.collection !== undefined && it.collection !== collection) throw new ApiErr(400, "INVALID_INPUT", `${where}.collection does not match the request`, "collection");
        if (!isObj(it.fields)) throw new ApiErr(400, "INVALID_INPUT", `${where}.fields is required`, "fields");
        const kind = it.kind ?? it.fields.kind;
        if (kind !== undefined && !KINDS.has(String(kind))) throw new ApiErr(400, "INVALID_INPUT", `${where}.kind "${String(kind)}" is not a class`, "kind");
        if (it.fields.kind !== undefined && it.kind !== undefined && it.fields.kind !== it.kind) throw new ApiErr(400, "INVALID_INPUT", `${where}.fields.kind must match kind`, "kind");
        if (typeof it.fields.body !== "string" || !it.fields.body.trim()) throw new ApiErr(400, "INVALID_INPUT", `${where}.fields.body is required for the mock`, "fields.body");
        if (it.timestamp !== undefined && (typeof it.timestamp !== "string" || Number.isNaN(Date.parse(it.timestamp))))
          throw new ApiErr(400, "INVALID_INPUT", `${where}.timestamp must be ISO-8601`, "timestamp");
        const md = it.metadata ?? {};
        if (!isObj(md)) throw new ApiErr(400, "INVALID_INPUT", `${where}.metadata must be an object`, "metadata");
        const mdBytes = bytes(md);
        if (mdBytes > METADATA_MAX)
          throw new ApiErr(400, "INVALID_INPUT", `metadata is too large (${mdBytes} bytes when serialized; the maximum is ${METADATA_MAX}).`, "metadata");
        const am = it.additional_metadata ?? {};
        if (!isObj(am)) throw new ApiErr(400, "INVALID_INPUT", `${where}.additional_metadata must be an object`, "additional_metadata");
        const amBytes = bytes(am);
        if (amBytes > ADDITIONAL_MAX)
          throw new ApiErr(400, "INVALID_INPUT", `additional_metadata is too large (${amBytes} bytes when serialized; the maximum is ${ADDITIONAL_MAX}). Reduce the number or size of metadata fields.`, "additional_metadata");
        for (const [k, v] of Object.entries(md)) {
          const f = declared.get(k);
          if (!f) {
            if (d.schema.length) throw new ApiErr(400, "INVALID_INPUT", `metadata field "${k}" is not declared in database_metadata_schema`, `metadata.${k}`);
            continue;
          }
          checkType(f, v, `metadata field "${k}"`);
        }
        if (it.relations !== undefined) {
          const rel = it.relations;
          if (isObj(rel)) {
            if (!Array.isArray(rel.ids) || rel.ids.some((x) => typeof x !== "string")) throw new ApiErr(400, "INVALID_INPUT", `${where}.relations.ids must be a string array`, "relations");
          } else if (!Array.isArray(rel)) throw new ApiErr(400, "INVALID_INPUT", `${where}.relations must be a list or {ids}`, "relations");
        }
      });

      const results = items.map((it: any) => {
        const k = this.key(d.name, collection, it.id);
        if (this.sources.has(k) && !upsert) {
          return { id: it.id, status: "failed", error: "context already exists and upsert=false", error_code: "ALREADY_EXISTS", title: it.title ?? null };
        }
        const relIds: string[] = isObj(it.relations) ? (it.relations.ids as string[]) : [];
        const missing = relIds.filter((x) => !this.sources.has(this.key(d.name, collection, x)));
        this.put(d.name, collection, it);
        return {
          id: it.id,
          status: "queued",
          error: null,
          error_code: null,
          title: it.title ?? null,
          infer: false,
          ...(relIds.length ? { relations_created: relIds.length - missing.length } : {}),
          ...(missing.length ? { relations_error: `relation targets not found: ${missing.join(",")}` } : {}),
        };
      });
      const failed = results.filter((r) => r.status === "failed").length;
      return this.ok(
        { success: failed === 0, message: `queued ${results.length - failed} context(s)`, results, success_count: results.length - failed, failed_count: failed },
        202,
      );
    });
  }

  private put(db: string, collection: string, it: any) {
    const k = this.key(db, collection, it.id);
    const prev = this.sources.get(k);
    if (prev) for (const c of prev.chunks) {
      this.index.remove(c);
      this.chunks.delete(c);
    }
    const body: string = it.fields.body;
    const title: string = it.title ?? it.fields.title ?? it.id;
    const src: Source = {
      id: it.id,
      title,
      url: it.url,
      kind: it.kind ?? it.fields.kind ?? "knowledge_base",
      body,
      metadata: it.metadata ?? {},
      additional: it.additional_metadata ?? {},
      relationIds: isObj(it.relations) ? [...(it.relations.ids as string[])] : [],
      timestamp: it.timestamp,
      ingestedAt: this.now(),
      chunks: [],
    };
    splitChunks(body).forEach((text, i) => {
      const uuid = `${it.id}_chunk_${i}`;
      this.chunks.set(uuid, { uuid, sourceKey: k, text });
      this.index.add(uuid, `${title}\n${text}`);
      src.chunks.push(uuid);
    });
    this.sources.set(k, src);
  }

  // ---------- GET /context/status ----------
  contextStatus(q: URLSearchParams): MockResponse {
    return this.wrap(() => {
      const d = this.db(q.get("database"), { requireReady: false });
      const collection = q.get("collection") || "default";
      const ids = [...new Set([...(q.getAll("ids").flatMap((v) => v.split(","))), ...(q.get("id") ? [q.get("id")!] : [])].map((s) => s.trim()).filter(Boolean))];
      if (!ids.length) throw new ApiErr(400, "INVALID_INPUT", "at least one id is required", "ids");
      const statuses = ids.map((id) => {
        const s = this.sources.get(this.key(d.name, collection, id));
        if (!s) return { id, indexing_status: "errored", error_code: "FILE_NOT_FOUND", error_message: "", message: "ID not found", success: false };
        return { id, indexing_status: this.statusOf(s), error_code: "", error_message: "", message: "Processing status retrieved successfully", success: true };
      });
      return this.ok({ statuses });
    });
  }

  // ---------- DELETE /context ----------
  deleteContext(body: unknown, strict: boolean): MockResponse {
    return this.wrap(() => {
      if (!isObj(body)) throw new ApiErr(400, "INVALID_INPUT", "body must be a JSON object");
      const d = this.db(body.database, { requireReady: true });
      const collection = typeof body.collection === "string" && body.collection ? body.collection : "default";
      if (!Array.isArray(body.ids) || !body.ids.length) throw new ApiErr(400, "INVALID_INPUT", "ids is required", "ids");
      const results = (body.ids as string[]).map((id) => {
        const k = this.key(d.name, collection, id);
        const s = this.sources.get(k);
        if (!s) return { id, deleted: false };
        if (strict && this.statusOf(s) !== "completed") throw new ApiErr(409, "SOURCE_PROCESSING", `source ${id} is still indexing`, "ids", { "Retry-After": "1" });
        for (const c of s.chunks) {
          this.index.remove(c);
          this.chunks.delete(c);
        }
        this.sources.delete(k);
        return { id, deleted: true };
      });
      const n = results.filter((r) => r.deleted).length;
      if (strict && n === 0) throw new ApiErr(404, "NOT_FOUND", "no contexts deleted");
      return this.ok({ success: true, message: `Successfully deleted ${n} source(s)`, results, deleted_count: n });
    });
  }

  // ---------- POST /query ----------
  query(body: unknown): MockResponse {
    return this.wrap(() => {
      const t0 = this.now();
      if (!isObj(body)) throw new ApiErr(400, "INVALID_INPUT", "body must be a JSON object");
      const d = this.db(body.database ?? body.tenant_id, { requireReady: true });
      const collection = typeof body.collection === "string" && body.collection ? body.collection : "default";
      if (typeof body.query !== "string" || !body.query.trim()) throw new ApiErr(400, "INVALID_INPUT", "query cannot be empty", "query");
      const type = body.type ?? "knowledge";
      if (!["knowledge", "memory", "all"].includes(String(type))) throw new ApiErr(400, "INVALID_INPUT", "type must be knowledge, memory or all", "type");
      const queryBy = body.query_by ?? "hybrid";
      if (!["hybrid", "text"].includes(String(queryBy))) throw new ApiErr(400, "INVALID_INPUT", "query_by must be hybrid or text", "query_by");
      const operator = body.operator ?? "or";
      if (!["or", "and", "phrase"].includes(String(operator))) throw new ApiErr(400, "INVALID_INPUT", "operator must be or, and or phrase", "operator");
      if (operator !== "or" && queryBy !== "text") throw new ApiErr(400, "INVALID_INPUT", `operator "${String(operator)}" requires query_by "text"`, "operator");
      const mode = body.mode ?? "auto";
      if (!["fast", "thinking", "auto"].includes(String(mode))) throw new ApiErr(400, "INVALID_INPUT", "mode must be fast, thinking or auto", "mode");
      const maxResults = body.max_results ?? 10;
      if (typeof maxResults !== "number" || !Number.isInteger(maxResults) || maxResults < 1 || maxResults > 250)
        throw new ApiErr(400, "INVALID_INPUT", "max_results must be an integer from 1 to 250", "max_results");
      if (body.alpha !== undefined && body.alpha !== "auto" && !(typeof body.alpha === "number" && body.alpha >= 0 && body.alpha <= 1))
        throw new ApiErr(400, "INVALID_INPUT", 'alpha must be a number from 0 to 1 or "auto"', "alpha");
      if (body.recency_bias !== undefined && !(typeof body.recency_bias === "number" && body.recency_bias >= 0 && body.recency_bias <= 1))
        throw new ApiErr(400, "INVALID_INPUT", "recency_bias must be from 0.0 to 1.0", "recency_bias");
      if (body.response_format !== undefined && !["structured", "markdown"].includes(String(body.response_format)))
        throw new ApiErr(400, "INVALID_INPUT", "response_format must be structured or markdown", "response_format");

      const match = compileFilters(body.metadata_filters, d.schema);
      const empty = { chunks: [] as unknown[], graph_context: { query_paths: [], chunk_relations: [], chunk_id_to_group_ids: {} }, additional_context: {} };
      if (type === "memory") return this.respond(empty, body, t0);

      const allowedSource = (s: Source) => {
        const st = this.statusOf(s);
        return (st === "graph_creation" || st === "completed") && match(s);
      };
      const prefix = `${d.name}/${collection}/`;
      const hits = this.index.search(body.query, maxResults, (uuid) => {
        const c = this.chunks.get(uuid);
        if (!c || !c.sourceKey.startsWith(prefix)) return false;
        const s = this.sources.get(c.sourceKey);
        return !!s && allowedSource(s);
      });

      const thinking = mode === "thinking" && queryBy === "hybrid";
      const forceful = thinking && body.query_forceful_relations !== false;
      const additional: Record<string, unknown> = {};
      const chunks = hits.map((h) => {
        const c = this.chunks.get(h.uuid)!;
        const s = this.sources.get(c.sourceKey)!;
        const extra: string[] = [];
        if (forceful) {
          for (const rid of s.relationIds) {
            const rs = this.sources.get(this.key(d.name, collection, rid));
            if (!rs || !allowedSource(rs) || !rs.chunks[0]) continue; // linked results follow the request's filters
            const rc = this.chunks.get(rs.chunks[0])!;
            extra.push(rc.uuid);
            additional[rc.uuid] = this.chunkJson(rc, rs, null);
          }
        }
        return this.chunkJson(c, s, h.score, extra);
      });
      const includeGraph = !(mode === "fast" && body.graph_context === false);
      const data: Record<string, unknown> = { chunks, additional_context: additional };
      if (includeGraph) {
        data.graph_context =
          this.graphMode === "metadata"
            ? metadataGraph(hits.map((h) => ({ chunk: this.chunks.get(h.uuid)!, source: this.sources.get(this.chunks.get(h.uuid)!.sourceKey)!, score: h.score })))
            : empty.graph_context; // default: the mock has no graph
      }
      return this.respond(data, body, t0);
    });
  }

  private chunkJson(c: ChunkRec, s: Source, score: number | null, extra: string[] = []) {
    const iso = new Date(s.ingestedAt).toISOString();
    return {
      chunk_uuid: c.uuid,
      id: s.id,
      chunk_content: c.text,
      source_type: "app",
      source_title: s.title,
      source_upload_time: iso,
      source_last_updated_time: s.timestamp ?? iso,
      layout: null,
      relevancy_score: score,
      extra_context_ids: extra,
      metadata: s.metadata,
      additional_metadata: s.additional,
    };
  }

  private respond(data: Record<string, unknown>, body: Record<string, unknown>, t0: number): MockResponse {
    const latency = { latency_ms: this.now() - t0 };
    if (body.response_format === "markdown") return this.ok(renderMarkdown(body.query as string, data), 200, latency);
    if (body.response_format !== "structured") data = { llm_prompt: renderMarkdown(body.query as string, data), ...data };
    return this.ok(data, 200, latency);
  }
}

function renderMarkdown(q: string, data: Record<string, unknown>) {
  const chunks = (data.chunks as { source_title: string; chunk_content: string }[]) ?? [];
  if (!chunks.length) return `# Instructions\n\n(MOCK) Query: ${q}\n\nNo results found for this query.\n`;
  return `# Instructions\n\n(MOCK) Query: ${q}\n\n## Results\n\n${chunks.map((c, i) => `### ${i + 1}. ${c.source_title}\n${c.chunk_content}`).join("\n\n")}`;
}

function checkType(f: FieldDef, v: unknown, label: string) {
  if (v === null) throw new ApiErr(400, "INVALID_INPUT", `${label} cannot be null`);
  switch (f.data_type) {
    case "VARCHAR":
      if (typeof v !== "string") throw new ApiErr(400, "INVALID_INPUT", `${label} must be of type string, got ${Array.isArray(v) ? "array" : typeof v}`);
      if (enc.encode(v).length > (f.max_length ?? 1024)) throw new ApiErr(400, "INVALID_INPUT", `${label} exceeds max_length ${f.max_length ?? 1024} bytes`);
      return;
    case "BOOL":
      if (typeof v !== "boolean") throw new ApiErr(400, "INVALID_INPUT", `${label} must be of type boolean, got ${typeof v}`);
      return;
    case "FLOAT":
    case "DOUBLE":
      if (typeof v !== "number" || !Number.isFinite(v)) throw new ApiErr(400, "INVALID_INPUT", `${label} must be a number`);
      return;
    case "JSON":
      return;
    default: {
      const r = INT_RANGE[f.data_type];
      if (typeof v !== "number" || !Number.isInteger(v) || (r && (v < r[0] || v > r[1])))
        throw new ApiErr(400, "INVALID_INPUT", `${label} must be an integer of type ${f.data_type}`);
    }
  }
}

/** Comma-joined multi-value membership (documented: "holds that value, at any position"). Token, not substring. */
const members = (v: unknown): string[] => (typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);

type Matcher = (s: Source) => boolean;

function compileFilters(raw: unknown, schema: FieldDef[]): Matcher {
  if (raw === undefined || raw === null) return () => true;
  if (!isObj(raw)) throw new ApiErr(400, "INVALID_INPUT", "metadata_filters must be an object", "metadata_filters");
  // Size cap measured after operator objects are reduced to their values.
  const reduced = JSON.parse(JSON.stringify(raw, (_k, v) => (isObj(v) && Object.keys(v).length === 1 && OPS.has(Object.keys(v)[0]!) ? (Array.isArray(Object.values(v)[0]) ? Object.values(v)[0] : [Object.values(v)[0]]) : v)));
  const size = bytes(reduced);
  if (size > FILTER_MAX) throw new ApiErr(400, "INVALID_INPUT", `metadata_filters is too large (${size} bytes when serialized; the maximum is ${FILTER_MAX}).`, "metadata_filters");
  const declared = new Map(schema.map((f) => [f.name, f]));
  const matchers: Matcher[] = [];
  for (const [key, val] of Object.entries(raw)) {
    if (val === null) throw new ApiErr(400, "INVALID_INPUT", "metadata_filters values cannot be null", `metadata_filters.${key}`);
    if (key === "additional_metadata" || key === "document_metadata") {
      if (!isObj(val)) throw new ApiErr(400, "INVALID_INPUT", `metadata_filters.${key} must be an object`, `metadata_filters.${key}`);
      for (const [ak, av] of Object.entries(val)) {
        if (av === null) throw new ApiErr(400, "INVALID_INPUT", "metadata_filters values cannot be null", `metadata_filters.${key}.${ak}`);
        if (Array.isArray(av) && av.length > 500) throw new ApiErr(400, "INVALID_INPUT", `metadata_filters.${key}.${ak} (got ${av.length}) must contain at most 500 values`);
        // Bare value = exact match, array = any. An operator object here is read as an exact object match.
        matchers.push((s) => (Array.isArray(av) ? av.some((x) => deepEqual(s.additional[ak], x)) : deepEqual(s.additional[ak], av)));
      }
      continue;
    }
    const f = declared.get(key);
    let op: string;
    let operand: unknown;
    if (isObj(val)) {
      const ks = Object.keys(val);
      const opKeys = ks.filter((k) => OPS.has(k));
      if (opKeys.length > 1 && opKeys.length === ks.length) throw new ApiErr(400, "INVALID_INPUT", `metadata_filters.${key}: only one operator per key`, `metadata_filters.${key}`);
      if (opKeys.length === 1 && ks.length === 1) {
        op = opKeys[0]!;
        operand = val[op];
      } else {
        // Misspelled operator / plain object: exact match against a stored object -> matches nothing for scalars.
        matchers.push((s) => deepEqual(s.metadata[key], val));
        continue;
      }
    } else if (Array.isArray(val)) {
      op = val.length === 1 ? "contains" : "contains_any";
      operand = val.length === 1 ? val[0] : val;
    } else {
      op = "equals";
      operand = val;
    }
    if (operand === null) throw new ApiErr(400, "INVALID_INPUT", "metadata_filters values cannot be null", `metadata_filters.${key}`);
    if (op === "contains_any") {
      if (!Array.isArray(operand)) throw new ApiErr(400, "INVALID_INPUT", `metadata_filters.${key}.contains_any must be an array`, `metadata_filters.${key}`);
      if (operand.length > 500) throw new ApiErr(400, "INVALID_INPUT", `metadata_filters.${key} (got ${operand.length}) must contain at most 500 values`);
      if (operand.some((x) => x === null || typeof x === "object")) throw new ApiErr(400, "INVALID_INPUT", `metadata_filters.${key}.contains_any values must be scalars`);
    } else if (Array.isArray(operand) || isObj(operand)) {
      throw new ApiErr(400, "INVALID_INPUT", `metadata_filters.${key}.${op} must be a single value`, `metadata_filters.${key}`);
    }
    if (f) {
      if ((op === "contains" || op === "contains_any") && f.data_type !== "VARCHAR")
        throw new ApiErr(400, "VALIDATION_ERROR", `metadata_filters.${key}: ${op} needs a VARCHAR field (field is ${f.data_type})`, `metadata_filters.${key}`);
      const vals = Array.isArray(operand) ? operand : [operand];
      for (const v of vals) {
        const okType =
          f.data_type === "VARCHAR" ? typeof v === "string" : f.data_type === "BOOL" ? typeof v === "boolean" : f.data_type === "JSON" ? true : typeof v === "number";
        if (!okType) throw new ApiErr(400, "VALIDATION_ERROR", `metadata_filters.${key}: value ${JSON.stringify(v)} does not fit field type ${f.data_type}`, `metadata_filters.${key}`);
      }
    } else {
      // Undeclared key: no source can hold it, so the filter matches nothing (no 400, no widening).
      matchers.push(() => false);
      continue;
    }
    if (op === "equals") matchers.push((s) => s.metadata[key] === operand);
    else if (op === "contains") matchers.push((s) => members(s.metadata[key]).includes(String(operand)));
    else matchers.push((s) => (operand as unknown[]).some((x) => members(s.metadata[key]).includes(String(x))));
  }
  return (s) => matchers.every((m) => m(s));
}

/** Paragraph chunks of at most ~120 words (deterministic, so tests can reason about chunk counts). */
export function splitChunks(body: string, maxWords = 120): string[] {
  const paras = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let cur: string[] = [];
  let n = 0;
  for (const p of paras) {
    const w = p.split(/\s+/).length;
    if (cur.length && n + w > maxWords) {
      out.push(cur.join("\n\n"));
      cur = [];
      n = 0;
    }
    cur.push(p);
    n += w;
  }
  if (cur.length) out.push(cur.join("\n\n"));
  return out.length ? out : [body];
}

/**
 * Opt-in demo graph (MOCK_GRAPH=metadata). Deterministic, built only from declared metadata of the chunks in
 * the current result set. Neutral predicates ("covers", "mentions"): a mention is not a deployment.
 * Shape mirrors v2 graph_context.query_paths[].triplets[] with relation.chunk_id and path.source_chunk_ids.
 */
export const MOCK_GRAPH_CONTEXT = "mock: derived from metadata";

function metadataGraph(rows: { chunk: ChunkRec; source: Source; score: number }[]) {
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const list = (v: unknown) => s(v).split(",").map((x) => x.trim()).filter(Boolean);
  const query_paths = rows.map(({ chunk, source, score }) => {
    const m = source.metadata;
    const page = s(m.page_title) || source.title;
    const triplets: unknown[] = [];
    const add = (sn: string, st: string, pred: string, tn: string, tt: string) => {
      if (!sn || !tn) return;
      triplets.push({
        source: { name: sn, type: st, namespace: "mock", entity_id: null, identifier: null },
        relation: { canonical_predicate: pred, raw_predicate: pred, context: MOCK_GRAPH_CONTEXT, chunk_id: chunk.uuid, relationship_id: null, temporal_details: null, timestamp: null },
        target: { name: tn, type: tt, namespace: "mock", entity_id: null, identifier: null },
      });
    };
    add(page, "PAGE", "covers_stage", s(m.journey_stage), "JOURNEY_STAGE");
    for (const p of list(m.platforms)) add(page, "PAGE", "mentions_platform", p, "PLATFORM");
    for (const v of list(m.vendors)) add(page, "PAGE", "mentions_vendor", v, "VENDOR");
    for (const t of list(m.topics)) add(page, "PAGE", "covers_topic", t, "TOPIC");
    const org = s(m.cs_organization);
    if (org) {
      add(org, "ORGANIZATION", "case_study_of", page, "PAGE");
      add(org, "ORGANIZATION", "located_in", s(m.cs_location), "LOCATION");
    }
    return { triplets, relevancy_score: score, combined_context: MOCK_GRAPH_CONTEXT, group_id: null, source_chunk_ids: [chunk.uuid] };
  }).filter((p) => p.triplets.length > 0);
  return { query_paths, chunk_relations: [], chunk_id_to_group_ids: {} };
}
