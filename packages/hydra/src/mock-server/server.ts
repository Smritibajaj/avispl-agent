import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { MockEngine, type EngineOptions, type MockResponse } from "./engine";

export interface MockServerOptions extends EngineOptions {
  port?: number;
  host?: string;
}

export interface RunningMock {
  url: string;
  port: number;
  engine: MockEngine;
  server: Server;
  close(): Promise<void>;
}

const MAX_BODY = 25 * 1024 * 1024;

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const parts: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > MAX_BODY) throw Object.assign(new Error("body too large"), { status: 413 });
    parts.push(c as Buffer);
  }
  return Buffer.concat(parts);
}

function send(res: ServerResponse, r: MockResponse) {
  const body = JSON.stringify(r.body);
  res.writeHead(r.status, { "Content-Type": "application/json", "X-HydraDB-Mock": "true", ...(r.headers ?? {}) });
  res.end(body);
}

const err = (status: number, code: string, message: string): MockResponse => ({
  status,
  body: { success: false, data: null, error: { code, message }, meta: { request_id: randomUUID(), latency_ms: 0, mock: true } },
});

async function parseJson(buf: Buffer): Promise<unknown> {
  if (!buf.length) return {};
  return JSON.parse(buf.toString("utf8"));
}

/** multipart/form-data -> Map (files are recorded as `{file:true}` so the engine can reject them). */
async function parseForm(buf: Buffer, contentType: string): Promise<Map<string, string | { file: true }>> {
  const fd = await new Response(new Uint8Array(buf), { headers: { "content-type": contentType } }).formData();
  const out = new Map<string, string | { file: true }>();
  for (const [k, v] of fd.entries()) out.set(k, typeof v === "string" ? v : { file: true });
  return out;
}

export function createMockHandler(engine: MockEngine) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? "/", "http://mock.local");
      const path = url.pathname.replace(/\/+$/, "") || "/";
      const method = (req.method ?? "GET").toUpperCase();

      if (path === "/health") return send(res, { status: 200, body: { ok: true, mock: true, search: engine.searchKind } });

      const auth = String(req.headers.authorization ?? "");
      if (!/^Bearer\s+\S+/.test(auth)) return send(res, err(401, "UNAUTHORIZED", "missing or invalid bearer token"));
      const apiVersion = req.headers["api-version"];
      if (apiVersion !== undefined && apiVersion !== "2") return send(res, err(400, "INVALID_INPUT", "mock serves API-Version 2 only"));

      const body = method === "GET" ? Buffer.alloc(0) : await readBody(req);
      const ct = String(req.headers["content-type"] ?? "");

      if (method === "POST" && path === "/databases") return send(res, engine.createDatabase(await parseJson(body)));
      if (method === "GET" && path === "/databases/status") return send(res, engine.databaseStatus(url.searchParams));
      const schemaMatch = path.match(/^\/databases\/([^/]+)\/metadata-schema$/);
      if (method === "GET" && schemaMatch) return send(res, engine.metadataSchema(decodeURIComponent(schemaMatch[1]!)));
      if (method === "POST" && path === "/context/ingest") {
        if (!ct.toLowerCase().startsWith("multipart/form-data")) return send(res, err(415, "UNSUPPORTED_MEDIA_TYPE", "use multipart/form-data"));
        return send(res, engine.ingest(await parseForm(body, ct)));
      }
      if (method === "GET" && path === "/context/status") return send(res, engine.contextStatus(url.searchParams));
      if (method === "DELETE" && path === "/context") {
        const strict = String(req.headers["x-hydradb-delete-status"] ?? "").toLowerCase() === "strict";
        return send(res, engine.deleteContext(await parseJson(body), strict));
      }
      if (method === "POST" && path === "/query") return send(res, engine.query(await parseJson(body)));
      return send(res, err(404, "NOT_FOUND", `mock does not implement ${method} ${path}`));
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 413) return send(res, err(413, "CONTENT_TOO_LARGE", "request body too large"));
      if (e instanceof SyntaxError) return send(res, err(400, "INVALID_INPUT", "invalid JSON body"));
      return send(res, err(500, "INTERNAL_ERROR", e instanceof Error ? e.message : String(e)));
    }
  };
}

export async function startMockServer(opts: MockServerOptions = {}): Promise<RunningMock> {
  const engine = new MockEngine(opts);
  const server = createServer(createMockHandler(engine));
  const host = opts.host ?? "127.0.0.1";
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, host, () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : (opts.port ?? 0);
  return {
    url: `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}`,
    port,
    engine,
    server,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
