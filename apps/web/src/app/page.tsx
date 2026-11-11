import { Chat } from "../components/Chat";
import { resolveModelMode } from "../lib/env";

// Read env at request time so the model banner always matches the running server.
export const dynamic = "force-dynamic";

export default function Page() {
  const mode = resolveModelMode();
  return <Chat modelMode={mode.kind} />;
}
