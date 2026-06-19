# Ralph Loop — Aurialis "Finish Incomplete Work"

You are running inside an autonomous Ralph loop (frankbria/ralph-claude-code).
Each iteration you complete **exactly one** task end-to-end, then exit so the
loop restarts with a fresh context.

## Each iteration

1. Read `ralph/fix_plan.md`. Pick the **first unchecked `[ ]`** task
   (top-to-bottom order == priority order). Skip `[blocked]` items.
2. Implement it test-first (TDD): write/extend the failing test (RED) →
   implement until it passes (GREEN) → refactor. Re-use the evidence and
   "Done when" line recorded under each task.
3. Run the full green gate **before** committing:
   - `pnpm exec tsc --noEmit`  → 0 errors
   - `pnpm run lint`           → exit 0
   - `pnpm test`               → 0 failures
   - If the task touches E2E or the backend, also run `pnpm test:e2e`
     and/or `pnpm test:backend:postman`.
4. Commit atomically: `<type>(<scope>): <summary>` followed by the
   `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.
5. Tick the task in `ralph/fix_plan.md` (`[x]`) and append `— <commit sha>`.
6. **Exit.** Never start a second task in the same iteration.

## Rules

- One task = one commit. The tree must be green at every commit.
- Never tick a task whose tests fail or whose implementation is partial —
  leave it `[ ]` and add a `BLOCKED: <reason>` note under it.
- If a task needs a secret or decision you don't have (e.g. a Cloudflare
  Turnstile site key), mark it `[blocked]` with the reason and move on.
- Surgical edits only. Match the surrounding code's style and idiom.
- When every task is `[x]` (or `[blocked]`) and the gate is green, write
  `ALL TASKS COMPLETE` to `ralph/STATUS` and stop.

## Project commands

| Purpose  | Command |
|----------|---------|
| Unit     | `pnpm test` |
| Lint     | `pnpm run lint` |
| Types    | `pnpm exec tsc --noEmit` |
| E2E      | `pnpm test:e2e` |
| Backend  | `pnpm test:backend:postman` |

AudioWorklet helpers are inlined automatically by the `pretest` hook.
