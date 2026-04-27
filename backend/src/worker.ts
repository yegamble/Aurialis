/**
 * Aurialis backend Worker — fronts the FastAPI container running in
 * Cloudflare Containers. Every incoming request is forwarded to the
 * single container instance (single-tenant: one global DO id).
 *
 * Why a Worker in front of the container?
 *   - Cloudflare Containers are addressed via a Durable Object stub. The
 *     Worker is the public entry point that resolves the stub and proxies.
 *   - This is also where we'd add CORS / auth / rate-limit headers if
 *     needed; for now it's a transparent passthrough.
 */

import { Container } from "@cloudflare/containers";

export class BackendContainer extends Container<Env> {
  /**
   * The FastAPI server inside the image listens on 8000 (see Dockerfile
   * `CMD ["uvicorn", ..., "--port", "8000"]`).
   */
  defaultPort = 8000;

  /**
   * Keep the container alive for 10 minutes after the last request. Cold
   * starts cost ~30s while PyTorch loads + Demucs models map into memory,
   * so we want to avoid spinning up per request. Sleep recovers cost
   * after a quiet stretch.
   */
  sleepAfter = "10m";
}

interface Env {
  BACKEND: DurableObjectNamespace<BackendContainer>;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Single global container instance for now — all jobs are queued
    // through one FastAPI process. If we need horizontal scale later we'll
    // shard by job_id (each id resolves to a distinct container).
    const id = env.BACKEND.idFromName("default");
    const stub = env.BACKEND.get(id);
    return stub.fetch(request);
  },
} satisfies ExportedHandler<Env>;
