import type { HydraDB } from "@hydradb/sdk";
import { HYDRA_METADATA_SCHEMA, type MetadataFieldDef } from "@avispl/shared";

/**
 * Fields we filter on (hard filters + every SearchFilters mapping).
 *
 * `enable_match` is NOT in packages/shared's MetadataFieldDef. The docs disagree: essentials/v2/metadata.md
 * filters fields with no flag at all, while essentials/v2/app-sources.md ("Add metadata for filtering")
 * says to declare filter keys "with `enable_match: true`", and the create-tenant OpenAPI example sets it.
 * Flags are fixed at creation, so we set it on every field we filter on. It is not an embedding flag
 * (it does not count toward the 6-flag limit per the schema reference).
 */
export const FILTERABLE_FIELDS = new Set([
  "journey_stage",
  "content_type",
  "platforms",
  "vendors",
  "topics",
  "room_sizes",
  "industry",
  "status",
  "meeting_room_relevant",
]);

/**
 * Logical (packages/shared) field name -> name actually declared in HydraDB.
 *
 * `source_url` is REJECTED by POST /databases (400 INVALID_INPUT "invalid database creation request", no field
 * detail; apiVersion 2.0.1). Verified by probe 2026-11-10: a one-field schema `source_url` VARCHAR(160) and
 * VARCHAR(512) both fail, `source_link` VARCHAR(512) succeeds, and the full 22-field schema with `source_url`
 * renamed to `page_url` succeeds. essentials/v2/metadata.md says names "such as source_id, chunk_id, metadata"
 * are reserved without giving the full list. The rest of the code (shared contract, EvidenceHit mapping) keeps
 * the logical name; only the wire sees the alias. Translate with toWireMetadata / fromWireMetadata.
 */
export const WIRE_FIELD_ALIASES: Readonly<Record<string, string>> = { source_url: "page_url" };
const WIRE_TO_LOGICAL: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(WIRE_FIELD_ALIASES).map(([k, v]) => [v, k]),
);

/** Names HydraDB refuses as metadata fields. Documented examples + `source_url` (probe-verified). */
export const RESERVED_FIELD_NAMES: ReadonlySet<string> = new Set(["source_id", "chunk_id", "metadata", "source_url"]);

export const wireFieldName = (logical: string): string => WIRE_FIELD_ALIASES[logical] ?? logical;
export const logicalFieldName = (wire: string): string => WIRE_TO_LOGICAL[wire] ?? wire;

/** Rename logical metadata keys to their HydraDB names (ingest side). */
export function toWireMetadata<V>(m: Record<string, V>): Record<string, V> {
  const out: Record<string, V> = {};
  for (const [k, v] of Object.entries(m)) out[wireFieldName(k)] = v;
  return out;
}

/** Rename HydraDB metadata keys back to logical names (query side). Logical keys already present win. */
export function fromWireMetadata<V>(m: Record<string, V>): Record<string, V> {
  const out: Record<string, V> = {};
  for (const [k, v] of Object.entries(m)) {
    const lk = logicalFieldName(k);
    if (lk !== k && k in out) continue;
    out[lk] = v;
  }
  return out;
}

/** Wire form (snake_case) as documented on POST /databases. Used for dry-run printing and by the mock. */
export interface WireFieldDef {
  name: string;
  data_type: MetadataFieldDef["data_type"];
  max_length?: number;
  enable_dense_embedding?: boolean;
  enable_sparse_embedding?: boolean;
  enable_match?: boolean;
}

export function toWireSchema(defs: readonly MetadataFieldDef[] = HYDRA_METADATA_SCHEMA): WireFieldDef[] {
  return defs.map((f) => {
    const out: WireFieldDef = { name: wireFieldName(f.name), data_type: f.data_type };
    if (f.max_length !== undefined) out.max_length = f.max_length;
    if (f.enable_dense_embedding) out.enable_dense_embedding = true;
    if (f.enable_sparse_embedding) out.enable_sparse_embedding = true;
    if (FILTERABLE_FIELDS.has(f.name)) out.enable_match = true;
    return out; // `purpose` is a human note and never sent
  });
}

/** SDK form (camelCase) for client.databases.create. */
export function toSdkSchema(defs: readonly MetadataFieldDef[] = HYDRA_METADATA_SCHEMA): HydraDB.TenantsCustomPropertyDefinition[] {
  return toWireSchema(defs).map((f) => ({
    name: f.name,
    dataType: f.data_type,
    ...(f.max_length !== undefined ? { maxLength: f.max_length } : {}),
    ...(f.enable_dense_embedding ? { enableDenseEmbedding: true } : {}),
    ...(f.enable_sparse_embedding ? { enableSparseEmbedding: true } : {}),
    ...(f.enable_match ? { enableMatch: true } : {}),
  }));
}

/** Same checks HydraDB documents for create (and the mock enforces). Returns problems, empty = OK. */
export function checkSchemaLimits(defs: readonly WireFieldDef[]): string[] {
  const problems: string[] = [];
  if (defs.length > 32) problems.push(`${defs.length} fields (max 32)`);
  const flags = defs.reduce((n, f) => n + (f.enable_dense_embedding ? 1 : 0) + (f.enable_sparse_embedding ? 1 : 0), 0);
  if (flags > 6) problems.push(`${flags} embedding flags (max 6)`);
  const seen = new Set<string>();
  for (const f of defs) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(f.name)) problems.push(`bad field name ${f.name}`);
    if (RESERVED_FIELD_NAMES.has(f.name.toLowerCase())) problems.push(`reserved field name ${f.name}`);
    if (seen.has(f.name.toLowerCase())) problems.push(`duplicate field ${f.name}`);
    seen.add(f.name.toLowerCase());
    if ((f.enable_dense_embedding || f.enable_sparse_embedding) && f.data_type !== "VARCHAR")
      problems.push(`${f.name}: embedding flags only on VARCHAR`);
    if (f.max_length !== undefined && (f.max_length < 1 || f.max_length > 65535)) problems.push(`${f.name}: max_length out of range`);
  }
  return problems;
}
