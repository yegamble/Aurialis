# Ralph harness for Aurialis

Autonomous "finish the incomplete work" loop, compatible with
[frankbria/ralph-claude-code](https://github.com/frankbria/ralph-claude-code).

## Files

- `PROMPT.md` — the per-iteration driver prompt (pick one task, TDD it, verify,
  commit, tick it off, exit).
- `fix_plan.md` — the ordered backlog. The single source of truth for what's
  left. Generated from a full audit of every plan doc + codebase scan, with each
  gap adversarially verified.
- `STATUS` — written by the loop when everything is done (`ALL TASKS COMPLETE`).

## Running it

```bash
# from the repo root, with ralph-claude-code installed:
ralph --prompt ralph/PROMPT.md --max-iterations 30

# or the plain shell-loop form (see the upstream repo):
while ! grep -q "ALL TASKS COMPLETE" ralph/STATUS 2>/dev/null; do
  claude -p "$(cat ralph/PROMPT.md)" --dangerously-skip-permissions
done
```

Each iteration runs the green gate (`pnpm exec tsc --noEmit`, `pnpm run lint`,
`pnpm test`, plus `pnpm test:e2e` / `pnpm test:backend:postman` when relevant)
before committing, so the tree stays green at every commit.

## Notes

- `[blocked]` items need a human input (e.g. the TurnstileGate task needs a
  Cloudflare Turnstile site key + Worker secret) — the loop skips them.
- This same backlog is also being executed in-session; keep `fix_plan.md` as the
  shared checklist so the two never double-do a task.
