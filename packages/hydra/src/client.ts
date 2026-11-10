import { HydraDB, HydraDBClient, HydraDBError, HydraDBTimeoutError } from "@hydradb/sdk";
import type { HydraConfig } from "./config";
import { HydraError } from "./errors";

/**
 * ONE code path to HydraDB: the official SDK (@hydradb/sdk 2.1.8).
 * Verified in node_modules/@hydradb/sdk/dist/BaseClient.d.ts: `baseUrl` overrides the environment,
 * so the same client talks to https://api.hydradb.com and to the local mock (http://localhost:4010).
 *
 * The SDK maps camelCase request fields to snake_case on the wire, and parses responses with
 * `unrecognizedObjectKeys: "passthrough"`, so undocumented keys (e.g. `origin`, `forceful_relations`)
 * survive in their wire spelling. `metadata` / `additional_metadata` / `additional_context` are records,
 * so their keys are NOT renamed.
 */

/** One `app_knowledge[]` item, wire format (snake_case, sent as a JSON string inside multipart). */
export interface AppKnowledgeItem {
  id: string;
  database: string;
  collection: string;
  title: string;
  url: string;
  kind: "knowledge_base";
  provider?: string;
  timestamp?: string;
  fields: { kind: "knowledge_base"; title: string; body: string };
  metadata: Record<string, string | number | boolean>;
  additional_metadata: Record<string, string>;
  relations?: { ids: string[] };
}

export interface StatusEntry {
  id: string;
  indexingStatus: string;
  errorCode: string;
  errorMessage: string;
}

export interface CallOptions {
  timeoutMs?: number;
  maxRetries?: number;
  signal?: AbortSignal;
}

export type QueryRequest = Omit<HydraDB.SearchQueryRequest, "database" | "collection">;
export type QueryResult = HydraDB.SearchV2RetrievalResult & Record<string, unknown>;

export interface QueryOutcome {
  data: QueryResult;
  meta: Record<string, unknown>;
}

export class HydraApi {
  readonly client: HydraDBClient;
  readonly config: HydraConfig;

  constructor(config: HydraConfig, opts: { maxRetries?: number; timeoutInSeconds?: number; fetch?: typeof fetch } = {}) {
    this.config = config;
    this.client = new HydraDBClient({
      token: config.apiKey,
      baseUrl: config.baseUrl,
      apiVersion: "2",
      maxRetries: opts.maxRetries ?? 2,
      timeoutInSeconds: opts.timeoutInSeconds ?? 60,
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
  }

  private ro(o: CallOptions = {}) {
    return {
      ...(o.timeoutMs !== undefined ? { timeoutInSeconds: o.timeoutMs / 1000 } : {}),
      ...(o.maxRetries !== undefined ? { maxRetries: o.maxRetries } : {}),
      ...(o.signal ? { abortSignal: o.signal } : {}),
    };
  }

  /** POST /databases. Idempotent: 409 DATABASE_ALREADY_EXISTS -> `{ created: false }`. */
  async createDatabase(schema: HydraDB.TenantsCustomPropertyDefinition[], o?: CallOptions) {
    try {
      const res = await this.client.databases.create(
        { database: this.config.database, databaseMetadataSchema: schema },
        this.ro(o),
      );
      return { created: true as const, status: res.data?.status, message: res.data?.message };
    } catch (e) {
      const err = toHydraError(e, "POST /databases");
      if (err.status === 409 || err.code === "DATABASE_ALREADY_EXISTS") return { created: false as const, status: "exists" };
      throw err;
    }
  }

  /** GET /databases/status. */
  async databaseStatus(o?: CallOptions) {
    try {
      const res = await this.client.databases.status({ database: this.config.database }, this.ro(o));
      const infra = res.data?.infra;
      return {
        readyForIngestion: infra?.readyForIngestion === true,
        infra: infra ?? {},
        message: res.data?.message,
      };
    } catch (e) {
      throw toHydraError(e, "GET /databases/status");
    }
  }

  /** GET /databases/{database}/metadata-schema (used by db:create to report schema drift). */
  async metadataSchema(o?: CallOptions): Promise<unknown> {
    try {
      const res = await this.client.databases.getMetadataSchema({ database: this.config.database }, this.ro(o));
      return res.data;
    } catch (e) {
      throw toHydraError(e, "GET /databases/metadata-schema");
    }
  }

  /** POST /context/ingest (multipart, type=knowledge, app_knowledge JSON string). */
  async ingestAppKnowledge(items: AppKnowledgeItem[], opts: { upsert?: boolean } & CallOptions = {}) {
    try {
      const res = await this.client.context.ingest(
        {
          type: "knowledge",
          database: this.config.database,
          collection: this.config.collection,
          appKnowledge: JSON.stringify(items),
          ...(opts.upsert !== undefined ? { upsert: opts.upsert ? "true" : "false" } : {}),
        },
        this.ro(opts),
      );
      const d = res.data ?? {};
      return {
        successCount: d.successCount ?? 0,
        failedCount: d.failedCount ?? 0,
        results: (d.results ?? []).map((r) => ({
          id: r.id ?? "",
          status: String(r.status ?? ""),
          error: r.error ?? null,
          errorCode: r.errorCode ?? null,
          relationsCreated: r.relationsCreated,
          relationsError: r.relationsError,
        })),
      };
    } catch (e) {
      throw toHydraError(e, "POST /context/ingest");
    }
  }

  /** GET /context/status for up to `ids.length` ids (caller batches). */
  async contextStatus(ids: string[], o?: CallOptions): Promise<StatusEntry[]> {
    try {
      const res = await this.client.context.status(
        { database: this.config.database, collection: this.config.collection, ids: ids.join(",") },
        this.ro(o),
      );
      return (res.data?.statuses ?? []).map((s) => ({
        id: s.id ?? "",
        indexingStatus: s.indexingStatus ?? "",
        errorCode: s.errorCode ?? "",
        errorMessage: s.errorMessage ?? "",
      }));
    } catch (e) {
      throw toHydraError(e, "GET /context/status");
    }
  }

  /** POST /query. Returns structured data (we always send response_format=structured). */
  async query(req: QueryRequest, o?: CallOptions): Promise<QueryOutcome> {
    try {
      const res = await this.client.query(
        { ...req, database: this.config.database, collection: this.config.collection, responseFormat: "structured" },
        this.ro(o),
      );
      if (!res.data || typeof res.data === "string") {
        throw new HydraError("response", "POST /query: expected structured data, got markdown or nothing");
      }
      return { data: res.data as QueryResult, meta: (res.meta ?? {}) as Record<string, unknown> };
    } catch (e) {
      throw toHydraError(e, "POST /query");
    }
  }

  /** DELETE /context (strict status, so a failed delete is an error, not a silent 200). */
  async deleteContext(ids: string[], o?: CallOptions) {
    try {
      const res = await this.client.context.delete(
        {
          database: this.config.database,
          collection: this.config.collection,
          ids,
          type: "knowledge",
          hydraDbDeleteStatus: "strict",
        },
        this.ro(o),
      );
      return res.data as unknown;
    } catch (e) {
      throw toHydraError(e, "DELETE /context");
    }
  }

  /**
   * Raw passthrough through the SDK (same auth/base URL). Used ONLY by the smoke test to see the wire
   * JSON exactly as HydraDB returns it (key spelling, undocumented fields).
   */
  async rawJson(path: string, init: { method: string; body?: unknown }, o?: CallOptions): Promise<{ status: number; json: unknown; ms: number }> {
    const t0 = performance.now();
    const res = await this.client.fetch(
      path,
      {
        method: init.method,
        ...(init.body !== undefined
          ? { body: JSON.stringify(init.body), headers: { "Content-Type": "application/json" } }
          : {}),
      },
      { ...(o?.timeoutMs ? { timeoutInSeconds: o.timeoutMs / 1000 } : {}), maxRetries: o?.maxRetries ?? 0 },
    );
    const text = await res.text();
    let json: unknown = text;
    try {
      json = JSON.parse(text);
    } catch {
      /* keep text */
    }
    return { status: res.status, json, ms: Math.round(performance.now() - t0) };
  }
}

/** Convert anything the SDK throws into a HydraError without leaking headers or the key. */
export function toHydraError(e: unknown, op: string): HydraError {
  if (e instanceof HydraError) return e;
  if (e instanceof HydraDBTimeoutError) return new HydraError("timeout", `${op}: timed out`, { cause: undefined });
  if (e instanceof HydraDBError) {
    const body = (e.body ?? {}) as Record<string, any>;
    const err = (body.error ?? body.detail ?? {}) as Record<string, any>;
    const meta = (body.meta ?? {}) as Record<string, any>;
    const code = typeof err.code === "string" ? err.code : undefined;
    const msg = typeof err.message === "string" ? err.message : typeof body === "string" ? String(body).slice(0, 300) : "";
    const requestId = meta.requestId ?? meta.request_id;
    if (e.statusCode === undefined) {
      return new HydraError("network", `${op}: ${e.message.split("\n")[0] ?? "network error"}`);
    }
    return new HydraError("request", `${op}: HTTP ${e.statusCode}${code ? ` ${code}` : ""}${msg ? `: ${msg}` : ""}`, {
      status: e.statusCode,
      code,
      requestId: typeof requestId === "string" ? requestId : undefined,
      param: typeof err.param === "string" ? err.param : undefined,
    });
  }
  if (e instanceof Error && e.name === "AbortError") return new HydraError("timeout", `${op}: aborted (deadline)`);
  return new HydraError("network", `${op}: ${e instanceof Error ? e.message : String(e)}`);
}
