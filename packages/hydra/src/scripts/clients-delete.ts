/**
 * clients:delete — delete one client profile (a customer asked for their data to be removed).
 * Usage: pnpm hydra clients:delete --chat=<chat id>
 */
import { HydraApi } from "../client";
import { clientProfileId, clientsConfig } from "../client-profiles";
import { HydraError } from "../errors";
import { loadDotEnv, parseArgs, run } from "./common";

run(async () => {
  const chat = parseArgs().values.get("chat");
  if (!chat) throw new HydraError("config", "usage: clients:delete --chat=<chat id>");
  loadDotEnv();
  const cfg = clientsConfig();
  const id = clientProfileId(chat);
  await new HydraApi(cfg).deleteContext([id]);
  console.log(`[hydra] deleted ${id} from ${cfg.database}/${cfg.collection}`);
});
