import {
  PLATFORMS,
  ROOM_SIZES,
  TOPICS,
  VENDORS,
} from "./vocab";
import { ADDITIONAL_METADATA_MAX_BYTES, HYDRA_METADATA_SCHEMA } from "./metadata";

let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.error("FAIL:", msg);
};

// 1. Multi-value (comma-joined, `contains`) vocabularies: no token may be a substring of another.
//    Single-value fields use `equals`, so collisions there are harmless.
const lists: Record<string, readonly string[]> = {
  PLATFORMS, VENDORS, TOPICS, ROOM_SIZES,
};
for (const [name, list] of Object.entries(lists)) {
  for (const a of list) for (const b of list) {
    if (a !== b && b.includes(a)) fail(`${name}: "${a}" is a substring of "${b}"`);
  }
}

// 2. HydraDB schema limits (docs: <=32 fields, <=6 embedding flags, unique case-insensitive names).
if (HYDRA_METADATA_SCHEMA.length > 32) fail(`schema has ${HYDRA_METADATA_SCHEMA.length} fields (max 32)`);
const flags = HYDRA_METADATA_SCHEMA.reduce(
  (n, f) => n + (f.enable_dense_embedding ? 1 : 0) + (f.enable_sparse_embedding ? 1 : 0), 0);
if (flags > 6) fail(`schema uses ${flags} embedding flags (max 6)`);
const names = HYDRA_METADATA_SCHEMA.map((f) => f.name.toLowerCase());
if (new Set(names).size !== names.length) fail("duplicate metadata field names");
for (const f of HYDRA_METADATA_SCHEMA) {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(f.name)) fail(`bad field name ${f.name}`);
  if ((f.enable_dense_embedding || f.enable_sparse_embedding) && f.data_type !== "VARCHAR")
    fail(`${f.name}: embedding flags only valid on VARCHAR`);
}
if (ADDITIONAL_METADATA_MAX_BYTES !== 1024) fail("additional_metadata cap changed");

if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log(`shared checks OK (${HYDRA_METADATA_SCHEMA.length} fields, ${flags} embedding flags)`);
