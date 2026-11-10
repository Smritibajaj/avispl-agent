import { existsSync } from "node:fs";
import path from "node:path";
import { Chat } from "../components/Chat";
import { resolveModelMode } from "../lib/env";
import { backendName, backendTarget } from "../lib/knowledge";

// Read env at request time so the data / model banners always match the running server.
export const dynamic = "force-dynamic";

// TODO(Nancy): drop the approved AVI-SPL logo at apps/web/public/brand/logo.svg; it replaces the text wordmark automatically.
const LOGO_PATH = "/brand/logo.svg";

export default function Page() {
  const mode = resolveModelMode();
  const hasLogo = existsSync(path.join(process.cwd(), "public", LOGO_PATH));
  return (
    <Chat
      backend={backendName()}
      target={backendTarget()}
      modelMode={mode.kind}
      logoSrc={hasLogo ? LOGO_PATH : undefined}
    />
  );
}
