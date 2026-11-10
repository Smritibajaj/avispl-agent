import { Chat } from "../components/Chat";
import { resolveModelMode } from "../lib/env";
import { backendName, backendTarget } from "../lib/knowledge";

// Read env at request time so the data / model banners always match the running server.
export const dynamic = "force-dynamic";

export default function Page() {
  const mode = resolveModelMode();
  return <Chat backend={backendName()} target={backendTarget()} modelMode={mode.kind} />;
}
