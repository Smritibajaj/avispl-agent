import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "../..");

// Env lives in the repo-root .env (see .env.example), shared with packages/hydra. Next itself only reads
// apps/web/.env*, so load the root file here. Existing variables (e.g. Vercel project env) are never
// overridden. AVISPL_ENV_FILE points elsewhere (used for local tests).
const envFile = process.env.AVISPL_ENV_FILE || path.join(repoRoot, ".env");
if (existsSync(envFile)) {
  const before = { ...process.env };
  process.loadEnvFile(envFile);
  for (const [k, v] of Object.entries(before)) process.env[k] = v;
}

const nextConfig: NextConfig = {
  transpilePackages: ["@avispl/shared", "@avispl/hydra"],
  // Monorepo: trace files from the repo root so Vercel bundles workspace packages correctly.
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  // The licensing disclosure is read from disk at runtime; make sure it ships with the routes.
  outputFileTracingIncludes: {
    "/api/chat": ["../../packages/shared/content/disclosure.txt"],
    "/api/health": ["../../packages/shared/content/disclosure.txt"],
  },
};

export default nextConfig;
