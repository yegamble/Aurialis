/**
 * CORS helper for Worker-handled responses. Mirrors the FastAPI CORSMiddleware
 * config in backend/main.py so browsers see consistent headers regardless of
 * which layer (Worker vs container) handled the request.
 *
 * The frontend reads `traceparent` to capture trace IDs in error UIs, so it
 * stays in `expose-headers`.
 */

interface CorsEnv {
  ALLOWED_ORIGINS: string;
}

const ALLOW_METHODS = "GET, POST, PUT, DELETE, OPTIONS";
const ALLOW_HEADERS = "content-type, traceparent";

function originAllowed(origin: string | null, env: CorsEnv): string | null {
  if (!origin) return null;
  const allowed = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
  return allowed.includes(origin) ? origin : null;
}

export function corsHeaders(request: Request, env: CorsEnv): HeadersInit {
  const origin = originAllowed(request.headers.get("Origin"), env);
  const headers: Record<string, string> = {
    "access-control-allow-methods": ALLOW_METHODS,
    "access-control-allow-headers": ALLOW_HEADERS,
    "access-control-allow-credentials": "true",
    "access-control-expose-headers": "traceparent",
    "access-control-max-age": "600",
    vary: "Origin",
  };
  if (origin) headers["access-control-allow-origin"] = origin;
  return headers;
}

export function preflightResponse(request: Request, env: CorsEnv): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export function withCors(
  request: Request,
  env: CorsEnv,
  body: BodyInit | null,
  init: ResponseInit = {}
): Response {
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(corsHeaders(request, env))) {
    if (typeof v === "string") headers.set(k, v);
  }
  return new Response(body, { ...init, headers });
}

export function jsonResponse(
  request: Request,
  env: CorsEnv,
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {}
): Response {
  const headers = new Headers({ "content-type": "application/json" });
  for (const [k, v] of Object.entries(corsHeaders(request, env))) {
    if (typeof v === "string") headers.set(k, v);
  }
  for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v);
  return new Response(JSON.stringify(data), { status, headers });
}

export function errorResponse(
  request: Request,
  env: CorsEnv,
  detail: string,
  status: number,
  extraHeaders: Record<string, string> = {}
): Response {
  return jsonResponse(request, env, { detail }, status, extraHeaders);
}
