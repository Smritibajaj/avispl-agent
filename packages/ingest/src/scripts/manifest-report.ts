import { SOURCES, isBriefSource, validateManifest } from "../sources";

const count = (key: (s: (typeof SOURCES)[number]) => string) => {
  const m = new Map<string, number>();
  for (const s of SOURCES) m.set(key(s), (m.get(key(s)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};
const print = (label: string, rows: [string, number][]) => {
  console.log(`\n${label}`);
  for (const [k, v] of rows) console.log(`  ${k.padEnd(22)} ${v}`);
};

console.log(`Manifest: ${SOURCES.length} entries (${SOURCES.filter(isBriefSource).length} from the brief + ${SOURCES.filter((s) => s.addedAfterBrief).length} added after the brief + ${SOURCES.filter((s) => s.derivedFrom).length} derived)`);
print("By status", count((s) => s.status));
print("By stage", count((s) => s.stage));
print("By priority", count((s) => s.priority));

console.log("\nBlocked (not scrapeable):");
for (const s of SOURCES.filter((x) => !["ready", "partial_scope"].includes(x.status)))
  console.log(`  #${s.n} ${s.id} [${s.status}] ${s.url ?? `(truncated) ${s.truncatedUrl}`}`);

const problems = validateManifest(SOURCES);
if (problems.length) {
  console.error(`\nFAIL: ${problems.length} problem(s)`);
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
console.log("\nmanifest OK: sources 1..60 present, no truncated URL in `url`");
