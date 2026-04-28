// Augment the auto-generated Cloudflare.Env (in worker-configuration.d.ts)
// with secret bindings that aren't in wrangler.jsonc. wrangler types only
// sees public vars + bindings.
//
// This file is a global ambient declaration (no top-level imports/exports).

declare namespace Cloudflare {
  interface Env {
    R2_ACCESS_KEY_ID: string;
    R2_SECRET_ACCESS_KEY: string;
    R2_ACCOUNT_ID: string;
    TURNSTILE_SECRET_KEY: string;
  }
}
