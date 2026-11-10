import {
  CONTENT_TYPES,
  INDUSTRIES,
  JOURNEY_STAGES,
  PLATFORMS,
  ROOM_SIZES,
  TOPICS,
  VENDORS,
  type SearchFilters,
} from "@avispl/shared";

/**
 * Hard filters: added by the store on EVERY query, applied last so nothing the model sends can override them.
 * (HydraDB never widens a filter, so these can only narrow.)
 */
export const HARD_FILTERS = Object.freeze({
  status: Object.freeze({ equals: "published" }),
  meeting_room_relevant: Object.freeze({ equals: true }),
}) as Readonly<Record<string, Readonly<Record<string, unknown>>>>;

export type MetadataFilters = Record<string, Record<string, unknown>>;

export interface FilterBuild {
  /** Only the model-chosen part, already mapped to operators. */
  model: MetadataFilters;
  /** Values the model sent that are not in our vocabularies (dropped, never sent). */
  dropped: string[];
}

const inList = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);

/**
 * Map the model's SearchFilters to HydraDB operators. Whitelisted keys only, vocabulary-checked values only.
 *   journey_stage, content_type, industry -> equals
 *   platforms, vendors, topics            -> contains_any (comma-joined VARCHAR)
 *   room_size                             -> contains on room_sizes
 * Input is treated as untrusted (it comes from a model tool call), so unknown keys like `status` are ignored.
 */
export function buildModelFilters(input: SearchFilters | undefined | null): FilterBuild {
  const model: MetadataFilters = {};
  const dropped: string[] = [];
  if (!input || typeof input !== "object") return { model, dropped };
  const f = input as Record<string, unknown>;

  const single = (key: "journey_stage" | "content_type" | "industry", list: readonly string[]) => {
    const v = f[key];
    if (v === undefined || v === null || v === "") return;
    if (inList(list, v)) model[key] = { equals: v };
    else dropped.push(`${key}=${String(v)}`);
  };
  single("journey_stage", JOURNEY_STAGES);
  single("content_type", CONTENT_TYPES);
  single("industry", INDUSTRIES);

  const multi = (key: "platforms" | "vendors" | "topics", list: readonly string[]) => {
    const v = f[key];
    if (v === undefined || v === null) return;
    const arr = Array.isArray(v) ? v : [v];
    const ok = [...new Set(arr.filter((x) => inList(list, x)))] as string[];
    for (const x of arr) if (!inList(list, x)) dropped.push(`${key}=${String(x)}`);
    if (ok.length) model[key] = { contains_any: ok };
  };
  multi("platforms", PLATFORMS);
  multi("vendors", VENDORS);
  multi("topics", TOPICS);

  const rs = f.room_size;
  if (rs !== undefined && rs !== null && rs !== "") {
    if (inList(ROOM_SIZES, rs)) model.room_sizes = { contains: rs };
    else dropped.push(`room_size=${String(rs)}`);
  }
  return { model, dropped };
}

/** Model filters + hard filters (hard last: they always win). */
export function withHardFilters(model: MetadataFilters): MetadataFilters {
  const out: MetadataFilters = {};
  for (const [k, v] of Object.entries(model)) if (!(k in HARD_FILTERS)) out[k] = { ...v };
  for (const [k, v] of Object.entries(HARD_FILTERS)) out[k] = { ...v };
  return out;
}

export const hardOnly = (): MetadataFilters => withHardFilters({});
