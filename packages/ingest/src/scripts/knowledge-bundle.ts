/**
 * knowledge:bundle — write one Markdown file per source and journey stage with the published, meeting-room
 * relevant sections of records.jsonl. These files are what a brief writer reads.
 *
 *   pnpm ingest knowledge:bundle [--records <records.jsonl>] [--out <dir>]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { RECORDS_FILENAME, type IngestRecord } from "@avispl/shared";
import { STAGE_LABELS } from "../knowledge";
import { DATA_DIR } from "../paths";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const file = arg("--records") ?? join(DATA_DIR, RECORDS_FILENAME);
  const out = arg("--out") ?? join(DATA_DIR, "knowledge-input");
  const records = (await readFile(file, "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l) as IngestRecord);
  const groups = new Map<string, IngestRecord[]>();
  for (const r of records) {
    if (r.metadata.status !== "published" || !r.metadata.meeting_room_relevant) continue;
    const key = `${r.sourceId}.${r.metadata.journey_stage}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  await mkdir(out, { recursive: true });
  const index: { key: string; sections: number; chars: number }[] = [];
  for (const [key, rs] of groups) {
    const m = rs[0]!.metadata;
    const head = [
      `# INPUT ${key}`,
      "",
      `- sourceId: ${rs[0]!.sourceId}`,
      `- stage: ${m.journey_stage} (${STAGE_LABELS[m.journey_stage]})`,
      `- page title: ${m.page_title}`,
      `- content type: ${m.content_type}${m.edition ? `, edition ${m.edition}` : ""}`,
      `- url: ${rs[0]!.url}`,
      m.cs_organization ? `- case study organisation: ${m.cs_organization}${m.cs_location ? `, ${m.cs_location}` : ""}` : "",
      rs.some((r) => r.metadata.legacy_platform) ? "- FLAG legacy_platform: this is Skype for Business / Polycom era proof" : "",
      rs.some((r) => r.metadata.metrics_are_estimates) ? "- FLAG metrics_are_estimates: the figures are analytics plus client estimates" : "",
      "",
    ].filter((l, i, a) => l !== "" || a[i - 1] !== "");
    const parts = rs.map((r) =>
      [
        `## SECTION id=${r.id}`,
        `heading: ${r.metadata.section}${r.metadata.page_range ? ` (p. ${r.metadata.page_range})` : ""}`,
        "",
        r.body.trim(),
        "",
      ].join("\n"),
    );
    const text = `${head.join("\n")}\n${parts.join("\n")}`;
    await writeFile(join(out, `${key}.md`), text);
    index.push({ key, sections: rs.length, chars: text.length });
  }
  await writeFile(join(out, "index.json"), JSON.stringify(index, null, 2));
  console.log(`[knowledge] ${index.length} bundles (${index.reduce((a, g) => a + g.sections, 0)} sections) written to ${out}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
