/**
 * Microsoft licensing disclosure switch. Decided 2026-11-10 by the project owner: no disclosure is required,
 * so it is OFF by default. Set LICENSING_DISCLOSURE=on (repo-root .env) to turn it back on: the agent then calls
 * getLicensingDisclosure and appends packages/shared/content/disclosure.txt word for word (or the pending line).
 * The tests run with it on so the feature stays verified.
 */
export const disclosureEnabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.LICENSING_DISCLOSURE?.trim().toLowerCase() === "on";
