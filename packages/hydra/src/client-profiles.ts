import type { HydraDB } from "@hydradb/sdk";
import { HydraApi, type AppKnowledgeItem } from "./client";
import { DEFAULT_BASE_URL, type HydraConfig } from "./config";
import { HydraConfigError, HydraError } from "./errors";
import type { WireFieldDef } from "./schema";

/**
 * Client profiles: what a customer told the advisor in one chat (intake answers, and contact details when they
 * asked for a meeting). Owner decision 2026-11-11: stored in HydraDB, dev only for now.
 *
 * They live in their OWN database with their own schema, never in the knowledge database: lead fields
 * (sector, platform, rooms, budget) need their own filters, and personal data (name, work email) must stay
 * apart from content the advisor searches. The advisor never reads this database.
 *
 * PERSONAL DATA: keep access to this database limited, tell customers it is saved (the booking form does),
 * and delete on request: `pnpm hydra clients:delete --chat=<chat id>`.
 */
export const CLIENTS_DEV_DATABASE = "avispl_clients_dev";
export const CLIENT_PROFILES_COLLECTION = "client-profiles";

/** Declared once at creation (additive only afterwards). No embedding flags: profiles are filtered, not searched. */
export const CLIENT_PROFILE_SCHEMA: WireFieldDef[] = [
  { name: "company", data_type: "VARCHAR", max_length: 160, enable_match: true },
  { name: "sector", data_type: "VARCHAR", max_length: 64, enable_match: true },
  { name: "platform", data_type: "VARCHAR", max_length: 64, enable_match: true },
  { name: "project_type", data_type: "VARCHAR", max_length: 64, enable_match: true },
  { name: "journey_stage", data_type: "VARCHAR", max_length: 64, enable_match: true },
  { name: "room_sizes", data_type: "VARCHAR", max_length: 128, enable_match: true },
  { name: "priorities", data_type: "VARCHAR", max_length: 256 },
  { name: "budget_level", data_type: "VARCHAR", max_length: 32, enable_match: true },
  { name: "timeline", data_type: "VARCHAR", max_length: 64 },
  { name: "support_need", data_type: "VARCHAR", max_length: 64 },
  { name: "region", data_type: "VARCHAR", max_length: 80, enable_match: true },
  { name: "rooms_count", data_type: "INT32" },
  { name: "meeting_requested", data_type: "BOOL", enable_match: true },
  { name: "created_on", data_type: "VARCHAR", max_length: 10 },
  { name: "chat_id", data_type: "VARCHAR", max_length: 80 },
];

export const clientProfileSdkSchema = (): HydraDB.TenantsCustomPropertyDefinition[] =>
  CLIENT_PROFILE_SCHEMA.map((f) => ({
    name: f.name,
    dataType: f.data_type,
    ...(f.max_length !== undefined ? { maxLength: f.max_length } : {}),
    ...(f.enable_match ? { enableMatch: true } : {}),
  }));

export interface ClientProfile {
  /** Chat id from the browser: one profile per conversation, later saves replace it (upsert). */
  chatId: string;
  /** Question and answer pairs, in the order they were asked. */
  answers: { question: string; answer: string }[];
  contact?: { name: string; email: string; company?: string; when?: string; region?: string; notes?: string };
  /** ISO date-time of this save. */
  at: string;
}

const one = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
/** VARCHAR max_length is in bytes: cut on characters until the UTF-8 size fits. */
const fit = (s: string, maxBytes: number) => {
  let t = one(s, maxBytes);
  while (new TextEncoder().encode(t).length > maxBytes) t = t.slice(0, -1);
  return t;
};

export const clientProfileId = (chatId: string): string => `client-${chatId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80)}`;

/** Which profile field a question fills, judged by its wording (the advisor writes the questions, so this is best effort). */
const FIELD_BY_QUESTION: [field: string, re: RegExp][] = [
  ["sector", /\bsector\b|line of work|industry/i],
  ["platform", /\bplatform\b/i],
  ["project_type", /\bproject\b|new rooms|upgrad|standardis/i],
  ["journey_stage", /\bstage\b|how far along/i],
  ["room_sizes", /room sizes?|which sizes|size of (?:the|your) rooms/i],
  ["priorities", /priorit|matters most/i],
  ["budget_level", /budget/i],
  ["timeline", /timeline|deadline|when do you need/i],
  ["support_need", /\bsupport\b/i],
];

/** Lead fields pulled out of the answers. Unknown points stay empty: nothing is guessed. */
export function clientProfileFields(p: ClientProfile): Record<string, string | number | boolean> {
  const f: Record<string, string> = {};
  for (const a of p.answers) {
    if (!a.question || /^(skip|not sure|don'?t know|just answer)\b/i.test(a.answer.trim())) continue;
    const hit = FIELD_BY_QUESTION.find(([, re]) => re.test(a.question));
    if (hit && !f[hit[0]]) f[hit[0]] = a.answer;
  }
  const rooms = p.answers.map((a) => /(\d[\d,]{0,6})\s+(?:[A-Za-z-]+\s+){0,2}rooms\b/i.exec(a.answer)?.[1]).find(Boolean);
  const max = (name: string) => CLIENT_PROFILE_SCHEMA.find((d) => d.name === name)?.max_length ?? 64;
  const v = (name: string, value: string | undefined) => fit(value ?? "", max(name));
  return {
    company: v("company", p.contact?.company),
    sector: v("sector", f.sector),
    platform: v("platform", f.platform),
    project_type: v("project_type", f.project_type),
    journey_stage: v("journey_stage", f.journey_stage),
    room_sizes: v("room_sizes", f.room_sizes),
    priorities: v("priorities", f.priorities),
    budget_level: v("budget_level", f.budget_level),
    timeline: v("timeline", f.timeline),
    support_need: v("support_need", f.support_need),
    region: v("region", p.contact?.region),
    rooms_count: rooms ? Math.min(Number(rooms.replace(/,/g, "")), 2_000_000_000) : 0,
    meeting_requested: !!p.contact,
    created_on: p.at.slice(0, 10),
    chat_id: v("chat_id", p.chatId),
  };
}

/** Markdown body: readable by a person in the HydraDB console. */
export function clientProfileBody(p: ClientProfile): string {
  const org = one(p.contact?.company ?? "", 120) || "Organisation not given";
  const lines = [`Client profile › ${org}`, ""];
  if (p.contact) {
    lines.push("## Contact", `- Name: ${one(p.contact.name, 100)}`, `- Work email: ${one(p.contact.email, 160)}`);
    if (p.contact.company) lines.push(`- Company: ${org}`);
    if (p.contact.region) lines.push(`- Region: ${one(p.contact.region, 80)}`);
    if (p.contact.when) lines.push(`- Best time to talk: ${one(p.contact.when, 200)}`);
    if (p.contact.notes) lines.push(`- Notes: ${one(p.contact.notes, 600)}`);
    lines.push("- Asked for a meeting with an AVI-SPL expert: yes", "");
  }
  lines.push("## What they told the advisor");
  for (const a of p.answers.slice(0, 60)) lines.push(`- ${one(a.question, 200) || "Their request"}: ${one(a.answer, 600)}`);
  return lines.join("\n");
}

export function buildClientProfileItem(p: ClientProfile, target: { database: string }): AppKnowledgeItem {
  const title = `Client profile › ${one(p.contact?.company ?? "", 120) || "Organisation not given"}`;
  return {
    id: clientProfileId(p.chatId),
    database: target.database,
    collection: CLIENT_PROFILES_COLLECTION,
    title,
    url: "https://avispl.com/", // items need a URL; a profile has no public page
    kind: "knowledge_base",
    timestamp: p.at,
    fields: { kind: "knowledge_base", title, body: clientProfileBody(p) },
    metadata: clientProfileFields(p),
    additional_metadata: { kind: "client_profile" },
  };
}

type Env = Record<string, string | undefined>;

/** Config for the clients database. `HYDRADB_CLIENTS_DATABASE` overrides the name; anything but dev needs `allowNonDev`. */
export function clientsConfig(env: Env = process.env, opts: { allowNonDev?: boolean; requireKey?: boolean } = {}): HydraConfig {
  const apiKey = (env.HYDRADB_API_KEY ?? "").trim();
  if (opts.requireKey !== false && !apiKey) throw new HydraConfigError("HYDRADB_API_KEY is not set");
  const database = (env.HYDRADB_CLIENTS_DATABASE ?? CLIENTS_DEV_DATABASE).trim();
  if (!/^[a-z0-9_-]{1,255}$/.test(database)) throw new HydraConfigError(`HYDRADB_CLIENTS_DATABASE "${database}" is not a valid database name`);
  if (database !== CLIENTS_DEV_DATABASE && !opts.allowNonDev)
    throw new HydraConfigError(`client profiles are only written to ${CLIENTS_DEV_DATABASE} (got ${database})`);
  const baseUrl = (env.HYDRADB_BASE_URL ?? DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  return { apiKey, baseUrl, database, collection: CLIENT_PROFILES_COLLECTION };
}

/** Upsert one profile. Throws on refusal or failure; the caller decides whether that matters (the chat must not break). */
export async function saveClientProfile(p: ClientProfile, env: Env = process.env): Promise<{ id: string; database: string }> {
  if (!p.answers.length && !p.contact) throw new HydraError("config", "client profile is empty");
  const config = clientsConfig(env);
  const item = buildClientProfileItem(p, config);
  const res = await new HydraApi(config, { timeoutInSeconds: 20, maxRetries: 1 }).ingestAppKnowledge([item], { upsert: true });
  if (res.failedCount > 0) throw new HydraError("response", `client profile rejected: ${res.results[0]?.errorCode ?? res.results[0]?.error ?? "unknown"}`);
  return { id: item.id, database: config.database };
}
