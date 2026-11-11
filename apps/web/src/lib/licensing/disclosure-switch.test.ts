import assert from "node:assert/strict";
import { test } from "node:test";
import { disclosureEnabled } from "../../config/disclosure";
import { SYSTEM_PROMPT, systemPrompt } from "../agent/system-prompt";

test("disclosure switch: off unless LICENSING_DISCLOSURE=on", () => {
  assert.equal(disclosureEnabled({} as NodeJS.ProcessEnv), false);
  assert.equal(disclosureEnabled({ LICENSING_DISCLOSURE: "on" } as unknown as NodeJS.ProcessEnv), true);
  assert.equal(systemPrompt(true), SYSTEM_PROMPT);
  const off = systemPrompt(false);
  assert.doesNotMatch(off, /LICENSING|getLicensingDisclosure/);
  assert.match(off, /\nGROUNDING:[\s\S]*\nEMERGENCY \([\s\S]*\nBOUNDARIES:\n/, "the rest of the prompt is intact");
});
