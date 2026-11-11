import { isDisclosurePending } from "@avispl/shared";
import { readDisclosureText } from "../../../lib/licensing/disclosure";
import { modelKeyConfigured, resolveModelMode } from "../../../lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const text = await readDisclosureText();
  const mode = resolveModelMode();
  return Response.json({
    ok: true,
    backend: "hydra",
    database: process.env.HYDRADB_DATABASE?.trim() || "not set",
    hydraKeyConfigured: !!process.env.HYDRADB_API_KEY?.trim(),
    disclosure: text === undefined ? "missing" : isDisclosurePending(text) ? "pending" : "approved",
    disclosurePending: text === undefined || isDisclosurePending(text),
    model: mode.id,
    modelMode: mode.kind,
    ...("note" in mode && mode.note ? { modelNote: mode.note } : {}),
    modelKeyConfigured: modelKeyConfigured(),
  });
}
