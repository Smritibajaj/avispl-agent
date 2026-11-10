import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = join(PKG_ROOT, "data");
export const RAW_DIR = join(DATA_DIR, "raw");
export const REPORTS_DIR = join(DATA_DIR, "reports");
export const REVIEW_DIR = join(DATA_DIR, "review");
export const CONFIG_DIR = join(DATA_DIR, "config");
export const PDF_DIR = join(DATA_DIR, "pdf");
export const rawPath = (id: string) => join(RAW_DIR, `${id}.json`);
