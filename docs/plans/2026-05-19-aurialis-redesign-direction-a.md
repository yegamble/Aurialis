# Aurialis Redesign — Direction A (Aurialis Studio)

Status: PENDING
Type: Feature
Worktree: No
Plan owner: yegamble@gmail.com
Source: `~/Downloads/Aurialis-handoff.zip` → `aurialis/project/lib/{app,views,primitives,data}.jsx`

## Goal

Implement Direction A from the Claude Design handoff: a macOS-workspace-style mastering studio with a window-chrome top bar, vibrancy sidebar (Library + Smart Master Album + Smart Split + Import + per-track list), workspace, and right-side meters/inspector on the master screen. Replaces the current three-route flow (`/`, `/master`, `/mix`) with a unified shell while keeping routes bookmarkable.

Design intent comes from the prototype JSX only — the `aurialis/project/src/*.tsx` files in the bundle are an identical snapshot of current code, not replacements. Tokens (`globals.css`) are already in place; the redesign is layout + new screens + new primitives.

## Out of scope (this plan)

- Direction B (Atrium) and Direction C (Console) — only Direction A.
- Light mode polish — dark mode first; light theme uses existing tokens.
- Backend changes to Smart Master Album scoring algorithms — UI shells call existing or stub endpoints with feature flag.

## Phases

Each phase: RED tests → GREEN impl → verify (vitest + playwright + lint + tsc) → commit.

### Phase 1 — App shell + Library

| # | Task | Type | Test contract |
|---|---|---|---|
| 1 | `WindowChrome` component | RTL | Renders 3 traffic-light dots; centered title "Aurialis" |
| 2 | `Sidebar` component with `NavGroup`, `NavItem`, `NavTrack` | RTL | `role="navigation"`; items Library/Smart Master Album/Smart Split/Import emit `onSelect(screen)` |
| 3 | `AppShell` wrapping `<children>` between WindowChrome + Sidebar | RTL | Renders chrome, nav, and children region; sidebar `data-screen` reflects active |
| 4 | `AlbumHeroCard` | RTL | Renders album title/artist + Avg LUFS + click handler |
| 5 | New `LibraryView` (replaces current `LibraryList` rendering on `/`) | RTL | Heading "Your tracks"; segmented filter `all/analyzed/drafts`; track count text; table-row per entry |
| 6 | Wire `/` page to use new shell + `LibraryView` | RTL + Playwright | `/` shows shell, nav, hero, list |

**E2E (Playwright)**: `aurialis-redesign-shell.spec.ts` — `/` renders shell, sidebar nav clickable, filter changes URL or list.

### Phase 2 — Master screen refactor

| # | Task | Test contract |
|---|---|---|
| 1 | `MasterToolbar` (top bar with track meta + mode `Segmented` + Export button) | RTL: mode toggle calls `onModeChange` |
| 2 | `BigReadout` primitive (LUFS-I / dBTP / LRA / DR / Corr) | RTL: renders label, value, sub, warn state |
| 3 | `MasterScreen` shell wrapping existing `SimpleMastering` / `AdvancedMastering` / `DeepMastering` | RTL: switches panel by `mode` prop |
| 4 | Wire `/master` page to new shell | Playwright: existing E2E specs pass; new visual assertions |

### Phase 3 — Stems ("Smart Split") + ExportView

| # | Task | Test contract |
|---|---|---|
| 1 | `StemsView` shell wrapping existing `StemMixer` etc. | RTL |
| 2 | `ExportView` polish using design layout | RTL |
| 3 | Wire `/mix` → StemsView; Export modal/page reuses ExportView | Playwright |

### Phase 4 — Smart Master Album (UI shell)

UI-only this phase. Backend contract deferred to a follow-up plan.

| # | Task | Test contract |
|---|---|---|
| 1 | `AlbumView` screen (LUFS bar chart + per-track consistency rows) | RTL |
| 2 | `/album` route + sidebar link | Playwright: clicking sidebar Smart Master Album opens `/album` |
| 3 | Stub data source via `useAlbumStore` (mock until backend lands) | unit |

### Phase 5 — Pro Mode toggle

| # | Task | Test contract |
|---|---|---|
| 1 | Pro Mode setting in zustand `useSettingsStore` (persisted) | unit |
| 2 | Toggle in sidebar footer | RTL |
| 3 | Goniometer + denser spectrum show when `pro === true` | RTL + Playwright |

## Test matrix per phase

1. `pnpm test` — vitest unit + RTL, **0 failures**.
2. `pnpm test:e2e` — playwright E2E, **0 failures**.
3. `pnpm lint && pnpm exec tsc --noEmit` — clean.
4. `pnpm test:backend:postman` — Newman PR Suite — **0 failures** against `local`. No API change in Phases 1–3, so contract must remain green.
5. Browser dev verify (`pnpm dev` + Playwright snapshot) on `/`, `/master`, `/mix`, `/album` when applicable.

## Risk register

| Risk | Mitigation |
|---|---|
| Big-bang shell rewrite breaks existing routes | Phase-gated; each phase keeps app shippable; route boundaries preserved |
| Playwright selectors hard-coded to current DOM | Update selectors in same phase as DOM change; bias to `data-testid` |
| Backend Postman tests fail unrelated to UI changes | Run baseline before Phase 1 starts to capture preexisting failures |
| Smart Master Album feature creep | UI shell only; backend contract deferred to follow-up |
| Routing collapse breaks deep links / bookmarks | Keep `/`, `/master`, `/mix` routes; `/album` is additive |

## Rollback

Each phase ships as one commit (or PR). Rollback = `git revert <sha>`. Components added are new files; the few wiring edits in `src/app/*/page.tsx` revert cleanly.

## Acceptance — overall plan complete when

- All 5 phases merged and tests green
- `/`, `/master`, `/mix`, `/album` render Direction A shell
- Pro Mode toggle persisted across reloads
- Postman PR Suite passes against local backend
- `pnpm build` succeeds
