import { z } from "zod";
import {
  ADDITIONAL_METADATA_MAX_BYTES,
  ChunkMetadataSchema,
  HYDRA_METADATA_SCHEMA,
  type IngestRecord,
} from "@avispl/shared";
import type { AppKnowledgeItem } from "./client";
import { WIRE_FIELD_ALIASES, toWireMetadata, wireFieldName } from "./schema";

/** HydraDB caps, compact JSON, UTF-8 bytes (essentials/v2/metadata.md "Size limits"). */
export const METADATA_MAX_BYTES = 16 * 1024;
export { ADDITIONAL_METADATA_MAX_BYTES };

const enc = new TextEncoder();
export const jsonBytes = (v: unknown): number => enc.encode(JSON.stringify(v)).length;
const utf8Bytes = (s: string): number => enc.encode(s).length;

const noTruncation = (u: string) => !u.includes("…") && !u.includes("...");

/**
 * Strict: an undeclared metadata key would be rejected by HydraDB anyway; we fail earlier and louder.
 * This is also what stops LOCAL-only fields (golden_queries, priority) from ever reaching HydraDB.
 */
export const StrictChunkMetadataSchema = ChunkMetadataSchema.strict();

/** Same rules, keyed by the names declared in HydraDB (see WIRE_FIELD_ALIASES). Validates outgoing items. */
export const StrictWireMetadataSchema = z
  .object(
    Object.fromEntries(
      Object.entries(ChunkMetadataSchema.shape).map(([k, v]) => [WIRE_FIELD_ALIASES[k] ?? k, v]),
    ) as Record<string, (typeof ChunkMetadataSchema.shape)[keyof typeof ChunkMetadataSchema.shape]>,
  )
  .strict();

const AdditionalSchema = z
  .object({
    contentHash: z.string().min(1),
    parentUrl: z.string().url().refine(noTruncation, "truncated URL").optional(),
    crawlNotes: z.string().optional(),
  })
  .strict();

export const IngestRecordSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(255)
    .refine((s) => !s.includes(","), "id must not contain commas (HydraDB rejects them)"),
  sourceId: z.string().min(1),
  title: z.string().min(1),
  url: z.string().url().max(512).refine(noTruncation, "truncated URL"),
  body: z.string().min(1),
  metadata: StrictChunkMetadataSchema,
  additional: AdditionalSchema,
  relationIds: z.array(z.string().min(1)),
  timestamp: z.string().datetime({ offset: true }).optional(),
});

export interface RecordProblem {
  line?: number;
  id?: string;
  problems: string[];
}

/** Byte-level checks zod cannot do: VARCHAR max_length is in BYTES; 16 KiB / 1 KiB map caps. */
export function checkRecordLimits(item: AppKnowledgeItem): string[] {
  const problems: string[] = [];
  const mBytes = jsonBytes(item.metadata);
  if (mBytes > METADATA_MAX_BYTES) problems.push(`metadata is ${mBytes} bytes (max ${METADATA_MAX_BYTES})`);
  const aBytes = jsonBytes(item.additional_metadata);
  if (aBytes > ADDITIONAL_METADATA_MAX_BYTES)
    problems.push(`additional_metadata is ${aBytes} bytes (max ${ADDITIONAL_METADATA_MAX_BYTES})`);
  for (const f of HYDRA_METADATA_SCHEMA) {
    const name = wireFieldName(f.name);
    const v = item.metadata[name];
    if (v === undefined) {
      problems.push(`metadata.${name} missing`);
      continue;
    }
    if (f.data_type === "VARCHAR" && typeof v === "string" && f.max_length && utf8Bytes(v) > f.max_length)
      problems.push(`metadata.${name} is ${utf8Bytes(v)} bytes (max_length ${f.max_length})`);
  }
  const declared = new Set(HYDRA_METADATA_SCHEMA.map((f) => wireFieldName(f.name)));
  for (const k of Object.keys(item.metadata)) if (!declared.has(k)) problems.push(`metadata.${k} is not declared in the schema`);
  return problems;
}

/** Map one IngestRecord to an `app_knowledge[]` item. Relations only when asked (phase 2). */
export function toAppKnowledgeItem(
  r: IngestRecord,
  target: { database: string; collection: string },
  opts: { withRelations: boolean; knownIds?: ReadonlySet<string> },
): AppKnowledgeItem {
  const additional: Record<string, string> = { sourceId: r.sourceId, contentHash: r.additional.contentHash };
  if (r.additional.parentUrl) additional.parentUrl = r.additional.parentUrl;
  if (r.additional.crawlNotes) additional.crawlNotes = r.additional.crawlNotes;
  const item: AppKnowledgeItem = {
    id: r.id,
    database: target.database,
    collection: target.collection,
    title: r.title,
    url: r.url,
    kind: "knowledge_base",
    fields: { kind: "knowledge_base", title: r.title, body: r.body },
    metadata: toWireMetadata({ ...r.metadata }),
    additional_metadata: additional,
  };
  if (r.timestamp) item.timestamp = r.timestamp;
  if (opts.withRelations) {
    const ids = r.relationIds.filter((x) => x !== r.id && (!opts.knownIds || opts.knownIds.has(x)));
    if (ids.length) item.relations = { ids };
  }
  return item;
}

/** Parse + validate JSONL text. Returns valid records and per-line problems (never throws on bad lines). */
export function parseRecordsJsonl(text: string, existingIds: ReadonlySet<string> = new Set()): {
  records: IngestRecord[];
  problems: RecordProblem[];
  /** Non-fatal: e.g. relationIds pointing outside the file (those ids are dropped at ingest). */
  warnings: RecordProblem[];
} {
  const records: IngestRecord[] = [];
  const problems: RecordProblem[] = [];
  const warnings: RecordProblem[] = [];
  const seen = new Set<string>();
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch (e) {
      problems.push({ line: i + 1, problems: [`invalid JSON: ${(e as Error).message}`] });
      return;
    }
    const parsed = IngestRecordSchema.safeParse(obj);
    const id = (obj as { id?: string })?.id;
    if (!parsed.success) {
      problems.push({
        line: i + 1,
        id,
        problems: parsed.error.issues.map((iss) => `${iss.path.join(".") || "(root)"}: ${iss.message}`),
      });
      return;
    }
    if (seen.has(parsed.data.id)) {
      problems.push({ line: i + 1, id, problems: ["duplicate id"] });
      return;
    }
    seen.add(parsed.data.id);
    records.push(parsed.data as IngestRecord);
  });
  // Relations must point at records in the same file (forceful-relation targets must exist).
  for (const r of records) {
    const missing = r.relationIds.filter((x) => !seen.has(x) && !existingIds.has(x));
    if (missing.length) warnings.push({ id: r.id, problems: [`relationIds not in file (dropped): ${missing.join(", ")}`] });
    if (r.relationIds.includes(r.id)) warnings.push({ id: r.id, problems: ["relationIds contains its own id (dropped)"] });
  }
  return { records, problems, warnings };
}

/** Cross-check of the two halves of the shared contract (zod object vs HydraDB schema). */
export function ChunkMetadataKeysMatchSchema(): { missingInZod: string[]; missingInSchema: string[] } {
  const zodKeys = Object.keys(ChunkMetadataSchema.shape);
  const schemaKeys = HYDRA_METADATA_SCHEMA.map((f) => f.name);
  return {
    missingInZod: schemaKeys.filter((k) => !zodKeys.includes(k)),
    missingInSchema: zodKeys.filter((k) => !schemaKeys.includes(k)),
  };
}
