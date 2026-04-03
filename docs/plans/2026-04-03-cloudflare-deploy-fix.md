# Cloudflare Deploy Build Failure Fix Plan

Created: 2026-04-03
Author: yegamble@gmail.com
Status: VERIFIED
Approved: Yes
Iterations: 0
Worktree: No
Type: Bugfix

## Summary

**Symptom:** Cloudflare deploy fails with `ENOENT: no such file or directory, open '.next/standalone/.next/server/pages-manifest.json'`
**Trigger:** Cloudflare build pipeline runs `npx wrangler deploy`, which auto-runs `@opennextjs/cloudflare migrate` + `opennextjs-cloudflare build`. The build expects `.next/standalone/` but it doesn't exist.
**Root Cause:** `next.config.ts:4` — `output: "export"` produces static HTML in `out/`, not a standalone Node.js server in `.next/standalone/`. OpenNext requires `output: "standalone"` to find `pages-manifest.json`.

## Investigation

- Commit `96f8860` added `output: "export"` to enable Cloudflare Pages static deployment
- The Cloudflare deploy command (`npx wrangler deploy`) auto-detected Next.js and used the OpenNext adapter, which requires standalone output
- No server-side features (SSR, server actions, etc.) are used — this is a fully client-side audio mastering app
- The `headers()` config in `next.config.ts` doesn't work with `output: "export"` (repeated warnings in build log)
- `public/_headers` was added as a COOP/COEP workaround for static export but is redundant with standalone output

## Fix Approach

**Chosen:** OpenNext + Cloudflare Workers (Approach A)
**Why:** Switching to `output: "standalone"` makes the build compatible with OpenNext. All changes are code-side (no Cloudflare dashboard changes needed). Headers work natively via `next.config.ts`. Pages are still statically generated at build time.
**Alternatives considered:**
- Static export to Pages (keep `output: "export"`, change dashboard config) — requires non-code changes
- Static export + wrangler Pages config — adds complexity for no benefit since the deploy pipeline already expects OpenNext

**Files:**
- `next.config.ts` — change `output: "export"` to `output: "standalone"`
- `package.json` — add `@opennextjs/cloudflare` + `wrangler` deps, add `deploy`/`preview` scripts
- `wrangler.jsonc` — create (Cloudflare Workers config)
- `open-next.config.ts` — create (OpenNext adapter config)
- `.gitignore` — add `.wrangler/`, `.open-next/` directories
- `public/_headers` — remove (redundant; `headers()` in next.config.ts works with standalone)

**Tests:** Build verification — `pnpm run build` must succeed with standalone output. Existing unit (259) and E2E (14) tests must continue passing.

## Progress

- [x] Task 1: Fix Next.js config and add Cloudflare deployment files
- [x] Task 2: Verify build and test suite
      **Tasks:** 2 | **Done:** 2

## Tasks

### Task 1: Fix Next.js config and add Cloudflare deployment files

**Objective:** Switch from static export to standalone output, add OpenNext + Cloudflare Workers configuration files
**Files:**
- `next.config.ts` — change `output: "export"` → `output: "standalone"`
- `package.json` — add `@opennextjs/cloudflare` (dependency) + `wrangler` (devDependency), add scripts: `"deploy": "opennextjs-cloudflare build && opennextjs-cloudflare deploy"`, `"preview": "opennextjs-cloudflare build && opennextjs-cloudflare preview"`
- `wrangler.jsonc` — create with worker name `aurialis`, `compatibility_date`, `nodejs_compat` flag, observability enabled
- `open-next.config.ts` — create minimal OpenNext config
- `.gitignore` — add `.wrangler/` and `.open-next/` entries
- `public/_headers` — delete (COOP/COEP headers now served by `headers()` in next.config.ts)
**TDD:** Not applicable — config-only changes. Verify via `pnpm run build` producing `.next/standalone/` directory.
**Verify:** `pnpm run build && ls .next/standalone/.next/server/pages-manifest.json`

### Task 2: Verify build and test suite

**Objective:** Full build, unit tests, and E2E tests pass with new config
**Verify:** `pnpm run build && pnpm test -- --reporter=dot && pnpm exec playwright test --workers=2`
