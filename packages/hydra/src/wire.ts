import { z } from "zod";
import { StrictWireMetadataSchema } from "./records";

/**
 * Zod schemas for the wire requests we send (snake_case, as documented on docs.hydradb.com v2).
 * Every script validates its request with these before sending, and `--dry-run` stops right after.
 */

export const WireFieldDefSchema = z
  .object({
    name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/),
    data_type: z.enum(["VARCHAR", "BOOL", "INT8", "INT16", "INT32", "INT64", "FLOAT", "DOUBLE", "JSON"]),
    max_length: z.number().int().min(1).max(65535).optional(),
    enable_dense_embedding: z.boolean().optional(),
    enable_sparse_embedding: z.boolean().optional(),
    enable_match: z.boolean().optional(),
  })
  .strict();

export const CreateDatabaseRequestSchema = z
  .object({
    database: z.string().regex(/^[a-z0-9_-]{1,255}$/),
    database_metadata_schema: z.array(WireFieldDefSchema).max(32),
  })
  .strict();

const noTrunc = (u: string) => !u.includes("…") && !u.includes("...");

export const AppKnowledgeItemSchema = z
  .object({
    id: z.string().min(1).refine((s) => !s.includes(","), "no commas"),
    database: z.string().min(1),
    collection: z.string().min(1),
    title: z.string().min(1),
    url: z.string().url().refine(noTrunc, "truncated URL"),
    kind: z.literal("knowledge_base"),
    provider: z.string().optional(),
    timestamp: z.string().datetime({ offset: true }).optional(),
    fields: z.object({ kind: z.literal("knowledge_base"), title: z.string().min(1), body: z.string().min(1) }).strict(),
    metadata: StrictWireMetadataSchema,
    additional_metadata: z.record(z.string(), z.string()),
    relations: z.object({ ids: z.array(z.string().min(1)).min(1) }).strict().optional(),
  })
  .strict();

export const AppKnowledgeBatchSchema = z.array(AppKnowledgeItemSchema).min(1);

const OpSchema = z.union([
  z.object({ equals: z.union([z.string(), z.number(), z.boolean()]) }).strict(),
  z.object({ contains: z.string() }).strict(),
  z.object({ contains_any: z.array(z.string()).min(1).max(500) }).strict(),
]);

export const QueryRequestWireSchema = z
  .object({
    database: z.string().min(1),
    collection: z.string().min(1),
    query: z.string().min(1),
    type: z.enum(["knowledge", "memory", "all"]),
    query_by: z.enum(["hybrid", "text"]),
    mode: z.enum(["fast", "thinking", "auto"]).optional(),
    max_results: z.number().int().min(1).max(250),
    alpha: z.number().min(0).max(1).optional(),
    recency_bias: z.number().min(0).max(1).optional(),
    graph_context: z.boolean().optional(),
    query_forceful_relations: z.boolean().optional(),
    response_format: z.literal("structured").optional(),
    metadata_filters: z.record(z.string(), OpSchema),
  })
  .strict();
