/**
 * Typed errors for packages/hydra. Messages NEVER contain the API key, request headers or raw bodies
 * that could echo credentials; only HydraDB's error code/message, HTTP status and request id.
 */

export type HydraErrorKind =
  | "config" // missing/invalid configuration (no key, bad database name...)
  | "validation" // our own pre-send validation failed (zod, size caps)
  | "request" // HydraDB answered with a non-2xx status
  | "timeout" // the request exceeded our deadline
  | "network" // fetch failed before a status code
  | "response"; // 2xx but the body did not have the documented shape

export class HydraError extends Error {
  readonly kind: HydraErrorKind;
  readonly status?: number;
  /** HydraDB machine code, e.g. DATABASE_NOT_FOUND, INVALID_INPUT, TENANT_INFRA_NOT_READY. */
  readonly code?: string;
  readonly requestId?: string;
  readonly param?: string;

  constructor(
    kind: HydraErrorKind,
    message: string,
    extra: { status?: number; code?: string; requestId?: string; param?: string; cause?: unknown } = {},
  ) {
    super(redact(message), extra.cause !== undefined ? { cause: extra.cause } : undefined);
    this.name = "HydraError";
    this.kind = kind;
    this.status = extra.status;
    this.code = extra.code;
    this.requestId = extra.requestId;
    this.param = extra.param;
  }
}

export class HydraConfigError extends HydraError {
  constructor(message: string) {
    super("config", message);
    this.name = "HydraConfigError";
  }
}

export class HydraValidationError extends HydraError {
  readonly issues: string[];
  constructor(message: string, issues: string[] = []) {
    super("validation", issues.length ? `${message}: ${issues.slice(0, 10).join("; ")}` : message);
    this.name = "HydraValidationError";
    this.issues = issues;
  }
}

/** Strip anything that looks like a bearer token or API key from a message. */
export function redact(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/(api[_-]?key|token|authorization)(["']?\s*[:=]\s*["']?)[^\s"',}]{6,}/gi, "$1$2[redacted]");
}
