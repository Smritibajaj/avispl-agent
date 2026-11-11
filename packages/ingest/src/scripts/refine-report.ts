/**
 * Before/after comparison of two records files:  tsx src/scripts/refine-report.ts <before.jsonl> [after.jsonl] [out.md]
 * Writes data/reports/refine-report.md (or out.md). Reasons come from data/reports/refine-events.json (written by prepare.ts).
 * Read-only for records; nothing is sent anywhere.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { JOURNEY_STAGES, RECORDS_FILENAME, type IngestRecord } from "@avispl/shared";
import { DATA_DIR, REPORTS_DIR } from "../paths";
import { getSource } from "../sources";
import type { SplitEvent } from "../split";
import { detectStage, tagInputFromBody } from "../tagger";

interface Events {
  duplicates: { sourceId: string; id: string; section: string; share: number; keptId: string; keptSource: string; keptSection: string }[];
  pages: Record<string, { events: SplitEvent[]; removed: { kind: string; preview: string }[]; linkOnlySections: string[]; thinSections: string[] }>;
}

const load = async (f: string) => (await readFile(f, "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l) as IngestRecord);
const wc = (s: string) => s.split(/\s+/).filter(Boolean).length;
const pct = (n: number, d: number) => `${n} of ${d} (${d ? Math.round((n / d) * 100) : 0}%)`;
const q = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor(xs.length * p))] ?? 0;
const cell = (s: string) => s.replace(/\|/g, "/").replace(/\s+/g, " ");

function distribution(rs: IngestRecord[]) {
  const w = rs.map((r) => wc(r.body)).sort((a, b) => a - b);
  const bucket = (lo: number, hi: number) => w.filter((x) => x >= lo && x <= hi).length;
  return {
    min: w[0] ?? 0, p10: q(w, 0.1), median: q(w, 0.5), p90: q(w, 0.9), max: w[w.length - 1] ?? 0,
    under40: bucket(0, 39), b40_79: bucket(40, 79), b80_300: bucket(80, 300), b301_400: bucket(301, 400), over400: bucket(401, Infinity),
  };
}

const coverage = (rs: IngestRecord[]) => ({
  platforms: rs.filter((r) => r.metadata.platforms).length,
  vendors: rs.filter((r) => r.metadata.vendors).length,
  topics: rs.filter((r) => r.metadata.topics).length,
  room_sizes: rs.filter((r) => r.metadata.room_sizes).length,
  industry: rs.filter((r) => r.metadata.industry !== "general").length,
});

async function main() {
  const beforeFile = process.argv[2];
  if (!beforeFile) throw new Error("usage: refine-report <before.jsonl> [after.jsonl]");
  const afterFile = process.argv[3] ?? join(DATA_DIR, RECORDS_FILENAME);
  const before = await load(beforeFile);
  const after = await load(afterFile);
  const events = JSON.parse(await readFile(join(REPORTS_DIR, "refine-events.json"), "utf8")) as Events;
  const A = new Map(before.map((r) => [r.id, r]));
  const B = new Map(after.map((r) => [r.id, r]));
  const removed = before.filter((r) => !B.has(r.id));
  const added = after.filter((r) => !A.has(r.id));
  const changed = after.filter((r) => A.has(r.id) && A.get(r.id)!.additional.contentHash !== r.additional.contentHash);
  const metaOnly = after.filter((r) => A.has(r.id) && A.get(r.id)!.additional.contentHash === r.additional.contentHash
    && JSON.stringify(A.get(r.id)!.metadata) !== JSON.stringify(r.metadata));
  const untouched = after.length - added.length - changed.length - metaOnly.length;

  const L: string[] = [];
  L.push(`# Refine report: knowledge-base clean-up`, ``,
    `Generated ${new Date().toISOString()}. Before: \`${beforeFile}\`. After: \`${afterFile}\`.`,
    `Built from the existing raw scrapes and PDF extracts only (nothing re-scraped). Word counts are whole-body words, breadcrumb line included, the same measure for both columns.`, ``);

  L.push(`## Totals`, ``, `| | before | after |`, `|---|---|---|`,
    `| records | ${before.length} | ${after.length} |`,
    `| sources with records | ${new Set(before.map((r) => r.sourceId)).size} | ${new Set(after.map((r) => r.sourceId)).size} |`,
    `| published | ${before.filter((r) => r.metadata.status === "published").length} | ${after.filter((r) => r.metadata.status === "published").length} |`,
    `| meeting_room_relevant = false | ${before.filter((r) => !r.metadata.meeting_room_relevant).length} | ${after.filter((r) => !r.metadata.meeting_room_relevant).length} |`, ``,
    `Ids: ${removed.length} old ids no longer exist, ${added.length} ids are new, ${changed.length} kept their id with cleaned text, ${metaOnly.length} kept id and text but changed metadata, ${untouched} are identical.`, ``);

  const da = distribution(before);
  const db = distribution(after);
  L.push(`## Word-length distribution`, ``, `| | before | after |`, `|---|---|---|`);
  for (const [label, k] of [["min", "min"], ["10th percentile", "p10"], ["median", "median"], ["90th percentile", "p90"], ["max", "max"],
    ["under 40 words", "under40"], ["40 to 79", "b40_79"], ["80 to 300", "b80_300"], ["301 to 400", "b301_400"], ["over 400", "over400"]] as const)
    L.push(`| ${label} | ${da[k]} | ${db[k]} |`);
  L.push(``, `The record's own heading is no longer repeated under the breadcrumb, so every record is shorter by the length of its heading; that alone moves some records that were just over 40 words to just under.`, ``);
  const shortNow = after.filter((r) => wc(r.body) < 40);
  L.push(`### Records still under 40 words (${shortNow.length}), kept because each states a fact and has no neighbour it belongs to`, ``);
  for (const r of shortNow) L.push(`- ${r.sourceId} › ${cell(r.metadata.section)} (${wc(r.body)}w): "${cell(r.body.split("\n").slice(2).join(" ")).slice(0, 140)}"`);
  const longNow = after.filter((r) => wc(r.body) > 300);
  L.push(``, `### Records over 300 words (${longNow.length})`, ``);
  for (const r of longNow) L.push(`- ${r.sourceId} › ${cell(r.metadata.section)} (${wc(r.body)}w)`);

  L.push(``, `## Records per journey stage`, ``, `| stage | before | after |`, `|---|---|---|`);
  for (const s of JOURNEY_STAGES) L.push(`| ${s} | ${before.filter((r) => r.metadata.journey_stage === s).length} | ${after.filter((r) => r.metadata.journey_stage === s).length} |`);
  L.push(``, `### Records whose stage was set from their own text (tagger.detectStage)`, ``,
    `Rule: the record's heading names deployment/installation/training (or monitoring/managed services/support) and at least a third of its sentences are about it, or at least three sentences and 60% of all sentences are about it; the other stage must have at most half as many. Case-study and other proof records are never moved by text (\`findCaseStudies\` looks for stage "proof"). All other differences in the table come from splitting records (a split record counts once per part).`, ``);
  let moved = 0;
  for (const r of after) {
    const src = getSource(r.sourceId);
    if (!src || src.contentType === "case_study") continue;
    const first = r.body.split("\n", 1)[0] ?? "";
    const pageTitle = first.startsWith(`${r.metadata.page_title} › `) ? r.metadata.page_title : (first.split(" › ")[0] ?? "");
    const ev = detectStage(tagInputFromBody(r.body, pageTitle));
    if (!ev || ev.stage !== r.metadata.journey_stage) continue;
    const old = A.get(r.id)?.metadata.journey_stage;
    if (old === r.metadata.journey_stage) continue;
    // PDF page ranges and pages whose default already is this stage are not "moved"
    if (src.stage === r.metadata.journey_stage || (src.contentType === "pdf" && !old)) continue;
    moved++;
    L.push(`- ${r.sourceId} › ${cell(r.metadata.section).slice(0, 110)}: ${old ?? src.stage} -> ${r.metadata.journey_stage} (${ev.stage === "deploy" ? ev.deploy : ev.run} of ${ev.sentences} sentences, heading ${ev.heading ? "names it" : "does not name it"})`);
  }
  if (!moved) L.push(`- none`);

  const ca = coverage(before);
  const cb = coverage(after);
  L.push(``, `## Tag coverage (records with at least one value)`, ``, `| field | before | after |`, `|---|---|---|`);
  for (const k of ["platforms", "vendors", "topics", "room_sizes"] as const) L.push(`| ${k} | ${pct(ca[k], before.length)} | ${pct(cb[k], after.length)} |`);
  L.push(`| industry other than "general" | ${pct(ca.industry, before.length)} | ${pct(cb.industry, after.length)} |`, ``,
    `Tags are set only from the record's own text plus the source's identity tags in the manifest. Room size and industry stay low because the text does not state them: most pages never name a room size, and the "general" records are platform, vendor and service pages that are not about one industry. No tag was added from guesswork.`, ``);
  const tagChanged = after.filter((r) => {
    const o = A.get(r.id);
    return o && (["platforms", "vendors", "topics", "room_sizes", "industry"] as const).some((f) => o.metadata[f] !== r.metadata[f]);
  });
  L.push(`### Tag changes on records that kept their id (${tagChanged.length})`, ``);
  for (const r of tagChanged) {
    const o = A.get(r.id)!;
    const diffs = (["platforms", "vendors", "topics", "room_sizes", "industry"] as const)
      .filter((f) => o.metadata[f] !== r.metadata[f]).map((f) => `${f}: "${o.metadata[f]}" -> "${r.metadata[f]}"`);
    L.push(`- ${r.sourceId} › ${cell(r.metadata.section).slice(0, 80)}: ${diffs.join("; ")}`);
  }

  // ---- what happened to every removed record ----
  const reasons = new Map<string, string[]>();
  const say = (kind: string, line: string) => reasons.set(kind, [...(reasons.get(kind) ?? []), line]);
  for (const r of removed) {
    const label = `${r.sourceId} › ${cell(r.metadata.section).slice(0, 90)} (${wc(r.body)}w)`;
    const page = events.pages[r.sourceId];
    const dup = events.duplicates.find((d) => d.id === r.id);
    if (dup) { say("Dropped as duplicate (same passage kept once)", `${label}: kept in ${dup.keptSource} › ${cell(dup.keptSection)}`); continue; }
    if (r.metadata.content_type === "pdf") {
      const [a, b = a] = r.metadata.page_range.split("-").map(Number) as [number, number?];
      const parts = after.filter((x) => x.sourceId === r.sourceId && Number(x.metadata.page_range.split("-")[0]) >= a && Number(x.metadata.page_range.split("-").pop()) <= b);
      say("Split: PDF page range into one record per page", `${label}: now ${parts.length} records (${parts.map((x) => `p.${x.metadata.page_range} ${wc(x.body)}w`).join(", ")})`);
      continue;
    }
    const split = page?.events.find((e) => (e.kind === "split_faq" || e.kind === "split_subheadings" || e.kind === "split_long") && e.section === r.metadata.section);
    if (split && "into" in split) { say("Split: FAQ section into one record per question", `${label}: now ${split.into.length} records`); continue; }
    const fam = page?.events.find((e) => e.kind === "merged_family" && e.members.includes(r.metadata.section));
    if (fam) { say("Merged: short cards of one heading family into their parent", `${label}: into "${cell(fam.section)}"`); continue; }
    const intro = r.metadata.section === "Overview" ? page?.events.find((e) => e.kind === "merged_intro") : undefined;
    if (intro && "into" in intro) { say("Merged: short page intro into the first section of the same page", `${label}: into "${cell(String(intro.into))}"`); continue; }
    const thin = page?.events.find((e) => e.kind === "dropped_thin" && (e.section === r.metadata.section || e.section.endsWith(r.metadata.section)));
    if (thin && "text" in thin) { say("Dropped: no usable fact", `${label}: "${cell(thin.text)}"`); continue; }
    const thinSec = page?.thinSections.find((t) => t.startsWith(`${r.metadata.section} (`));
    if (thinSec) { say("Dropped: no usable fact", `${label}: after removing boilerplate only ${cell(thinSec.slice(r.metadata.section.length + 1))} remained`); continue; }
    say("Unexplained (check)", label);
  }
  L.push(``, `## Dropped and merged records (${removed.length} old ids gone)`, ``);
  for (const [kind, lines] of reasons) L.push(`### ${kind} (${lines.length})`, ``, ...lines.map((l) => `- ${l}`), ``);

  L.push(`## Split records (kept their id for the first part, new ids for the rest)`, ``);
  for (const [id, page] of Object.entries(events.pages)) {
    for (const e of page.events) {
      if (e.kind !== "split_subheadings" && e.kind !== "split_long") continue;
      const why = e.kind === "split_long" ? "over the size limit, split at paragraph boundaries" : "sub-headed cards separated from the section they were filed under";
      L.push(`- ${id} › ${cell(e.section).slice(0, 80)} (${e.words}w): ${why} -> ${e.into.length} records: ${e.into.map((x) => `"${cell(x).slice(0, 70)}"`).join(", ")}`);
    }
  }

  L.push(``, `## Cleaned inside records (text removed, nothing reworded)`, ``);
  const kinds = new Map<string, { n: number; sources: Set<string>; sample: string }>();
  for (const [id, page] of Object.entries(events.pages)) {
    for (const r of page.removed) {
      const k = kinds.get(r.kind) ?? { n: 0, sources: new Set<string>(), sample: r.preview };
      k.n++;
      k.sources.add(id);
      kinds.set(r.kind, k);
    }
  }
  const kindLabel: Record<string, string> = {
    media_fallback: "video/flip-book player fallback text", blog_nav: "blog back/next links", share_links: "share buttons",
    anchor_nav: "in-page anchor menus", related_posts: "\"You may also like\" teaser blocks", logo_caption: "caption of a logo strip (\"Partners\")",
  };
  for (const [k, v] of kinds) L.push(`- ${kindLabel[k] ?? k}: ${v.n} block(s) on ${v.sources.size} page(s), e.g. "${cell(v.sample)}"`);
  L.push(`- the record's own heading line under the breadcrumb: removed from every web record (it is the last element of the breadcrumb)`,
    `- PDF pages: page markers, lone figure numbers, ">Call to action" lines, footer links, and pull quotes printed twice`,
    `- markup only: link cards written as "[\\\\ + line break + **Label**](url)" are now "[Label](url)"; a bold drop cap split from its word ("**W** hat") is joined`, ``);

  const outFile = process.argv[4] ?? join(REPORTS_DIR, "refine-report.md");
  await writeFile(outFile, L.join("\n") + "\n");
  console.log(`wrote ${outFile}: ${before.length} -> ${after.length} records; removed ${removed.length}, new ${added.length}, changed ${changed.length}, metadata-only ${metaOnly.length}, identical ${untouched}`);
  const unexplained = reasons.get("Unexplained (check)");
  if (unexplained?.length) console.log(`UNEXPLAINED removals: ${unexplained.join(" | ")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
