import { isDisclosurePending } from "@avispl/shared";
import { readDisclosureText } from "../../../lib/disclosure";
import { modelKeyConfigured, resolveModelMode } from "../../../lib/env";
import { backendName, backendTarget } from "../../../lib/knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const text = await readDisclosureText();
  const mode = resolveModelMode();
  return Response.json({
    ok: true,
    backend: backendName(),
    backendTarget: backendTarget(),
    disclosure: text === undefined ? "missing" : isDisclosurePending(text) ? "pending" : "approved",
    disclosurePending: text === undefined || isDisclosurePending(text),
    model: mode.id,
    modelMode: mode.kind,
    ...(mode.kind === "demo" ? { demoReason: mode.reason } : {}),
    ...("note" in mode && mode.note ? { modelNote: mode.note } : {}),
    modelKeyConfigured: modelKeyConfigured(),
  });
}
