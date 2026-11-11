/**
 * knowledge:build — validate the authored briefs against the section records they restate and write
 * data/records.knowledge.jsonl (IngestRecord per line, status published) plus a coverage report.
 *
 *   pnpm ingest knowledge:build [--records <records.jsonl>] [--briefs <dir>] [--out <file>] [--report <file>]
 *
 * Exits 1 and writes nothing when any brief has an error (an invented number, a wrong section id...).
 * Warnings (copied runs, names missing from the sections) are printed for a person to read.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { JOURNEY_STAGES, PLATFORMS, RECORDS_FILENAME, ROOM_SIZES, TOPICS, VENDORS, type IngestRecord } from "@avispl/shared";
import { BriefSchema, KNOWLEDGE_RECORDS_FILENAME, STAGE_LABELS, buildBriefRecord, checkBrief, type Brief } from "../knowledge";
import { DATA_DIR, PKG_ROOT, REPORTS_DIR } from "../paths";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const recordsFile = arg("--records") ?? join(DATA_DIR, RECORDS_FILENAME);
  const briefsDir = arg("--briefs") ?? join(PKG_ROOT, "knowledge", "briefs");
  const outFile = arg("--out") ?? join(DATA_DIR, KNOWLEDGE_RECORDS_FILENAME);
  const reportFile = arg("--report") ?? join(REPORTS_DIR, "knowledge-report.md");

  const records = (await readFile(recordsFile, "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l) as IngestRecord);
  const byId = new Map(records.map((r) => [r.id, r]));
  const files = (await readdir(briefsDir)).filter((f) => f.endsWith(".json")).sort();

  const built: IngestRecord[] = [];
  const covered = new Set<string>();
  let errorCount = 0;
  const warningLines: string[] = [];
  for (const f of files) {
    const fail = (msg: string) => {
      errorCount++;
      console.error(`ERROR ${f}: ${msg}`);
    };
    let brief: Brief;
    try {
      const parsed = BriefSchema.safeParse(JSON.parse(await readFile(join(briefsDir, f), "utf8")));
      if (!parsed.success) {
        fail(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
        continue;
      }
      brief = parsed.data;
    } catch (e) {
      fail(`not valid JSON (${e instanceof Error ? e.message : e})`);
      continue;
    }
    const missing = brief.basedOn.filter((id) => !byId.has(id));
    if (missing.length) {
      fail(`basedOn ids not in ${recordsFile}: ${missing.join(", ")}`);
      continue;
    }
    const sections = brief.basedOn.map((id) => byId.get(id)!);
    const wrongStage = sections.filter((r) => r.metadata.journey_stage !== brief.stage);
    if (wrongStage.length) fail(`sections of another stage: ${wrongStage.map((r) => `${r.id} (${r.metadata.journey_stage})`).join(", ")}`);
    const { errors, warnings } = checkBrief(brief, sections);
    errors.forEach(fail);
    for (const w of warnings) warningLines.push(`- \`${f}\`: ${w}`);
    if (errors.length || wrongStage.length) continue;
    const record = buildBriefRecord(brief, sections, { platforms: PLATFORMS, vendors: VENDORS, topics: TOPICS, roomSizes: ROOM_SIZES });
    if (byId.has(record.id) || built.some((b) => b.id === record.id)) {
      fail(`duplicate record id ${record.id} (same source, stage and slug as another brief)`);
      continue;
    }
    built.push(record);
    brief.basedOn.forEach((id) => covered.add(id));
  }

  const eligible = records.filter((r) => r.metadata.status === "published" && r.metadata.meeting_room_relevant);
  const uncovered = eligible.filter((r) => !covered.has(r.id));
  const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;
  const report = [
    "# Expert briefs: build report",
    "",
    `Sections: \`${recordsFile}\`. Briefs: \`${briefsDir}\` (${files.length} files).`,
    "",
    "| stage | section records | sections restated | briefs | brief words (median) |",
    "|---|---|---|---|---|",
    ...JOURNEY_STAGES.map((s) => {
      const el = eligible.filter((r) => r.metadata.journey_stage === s);
      const bs = built.filter((r) => r.metadata.journey_stage === s);
      const ws = bs.map((r) => wordCount(r.body)).sort((a, b) => a - b);
      return `| ${STAGE_LABELS[s]} | ${el.length} | ${el.filter((r) => covered.has(r.id)).length} | ${bs.length} | ${ws[Math.floor(ws.length / 2)] ?? 0} |`;
    }),
    "",
    `## Sections no brief restates (${uncovered.length})`,
    "",
    ...uncovered.map((r) => `- ${r.sourceId} (${r.metadata.journey_stage}) › ${r.metadata.section}`),
    "",
    `## Warnings to read (${warningLines.length})`,
    "",
    ...warningLines,
    "",
  ].join("\n");

  if (errorCount) {
    console.error(`[knowledge] ${errorCount} error(s); nothing written`);
    process.exit(1);
  }
  await mkdir(dirname(outFile), { recursive: true });
  await mkdir(dirname(reportFile), { recursive: true });
  await writeFile(outFile, built.map((r) => JSON.stringify(r)).join("\n") + "\n");
  await writeFile(reportFile, report);
  console.log(`[knowledge] ${built.length} brief records written to ${outFile}`);
  console.log(`[knowledge] ${covered.size}/${eligible.length} sections restated, ${warningLines.length} warning(s); report: ${reportFile}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
