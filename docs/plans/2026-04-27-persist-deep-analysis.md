# Persist Deep Analysis Library Implementation Plan

Created: 2026-04-27
Author: yegamble@gmail.com
Status: VERIFIED
Approved: Yes
Iterations: 1
Worktree: No
Type: Feature

## Summary

**Goal:** Persist Deep Analysis results (script, audio file, mastering settings) in the browser per song so users can return to a previously-analyzed track without re-uploading or re-running the slow backend job. Surface a library list on the upload screen so users can browse, open, and delete previously-analyzed songs.

**Architecture:** Add a `useLibraryStore` Zustand store backed by a two-tier persistence layer — IndexedDB for metadata + analysis JSON + mastering settings (small, indexed), OPFS for audio Blobs (large, sequential I/O). Identify songs by a cheap fingerprint (`name|size|lastModified`), with SHA-256 fallback on apparent collision. Hook into existing `useDeepStore.setScript` and `useAudioStore` mutations to write through to persistence; hook into `UploadScreen` to detect known files and auto-hydrate.

**Tech Stack:** TypeScript, Zustand, native IndexedDB (via `idb-keyval` for ergonomics), OPFS (`navigator.storage.getDirectory()`), Web Crypto SubtleCrypto for SHA-256, existing testing stack (Vitest + Playwright).

## Scope

### In Scope

- Two-tier browser persistence: IndexedDB (metadata + script + settings) + OPFS (audio Blobs).
- Hybrid file fingerprint: `name|size|lastModified` first, SHA-256 of audio bytes on apparent collision.
- 20-song hard cap with LRU eviction (least-recently-opened evicted on insert).
- Library list rendered below the drop zone on the upload screen (`/`).
- On re-upload of a known file: show a "Resume vs Start fresh" dialog. **Resume** (default) = hydrate `useDeepStore` and `useAudioStore` from the library entry, skip re-analyze, show "Loaded from library" badge. **Start fresh** = warn the user that the saved analysis and mastering settings for this song will be overwritten on the next analyze; on confirm, proceed with empty stores (existing flow). The dialog has a "Don't ask again — always resume" checkbox that persists in `useLibraryStore.preferences.alwaysResume`.
- Manual delete from library (per entry).
- Persist mastering settings: `useAudioStore.params`, simple-mode `genre`/`intensity`/`toggles`, `tonePreset`, `outputPreset`. Saved per library entry, restored on open.
- Graceful degradation: if OPFS unsupported, persist analysis+settings only (no audio); if IndexedDB unavailable (private mode), library disables silently.
- LRU bump on open (touch `lastOpenedAt` so eviction order tracks usage, not creation).

### Out of Scope

- Server-side persistence / cross-device sync (browser-only).
- Sharing library entries between users.
- Versioning or diff of analysis runs (a re-analyze overwrites the previous script for that fingerprint).
- Stem MixerStore persistence (separate feature; only Deep Mastering settings persist).
- Bulk import/export of library.
- Library search/filter UI (list is short — 20 max).
- Storage usage gauge in UI (can ship later if needed).

## Approach

**Chosen:** **Two-tier persistence with a thin `library-store` facade.**

A `LibraryEntry` is the unit. Metadata + analysis JSON + mastering settings are written to a single IndexedDB object store keyed by fingerprint. Audio Blobs are written to OPFS at `library/<fingerprint>.<ext>`. The `useLibraryStore` Zustand store hydrates on mount, exposes `add`, `open`, `remove`, `touch`, and listens for `setScript` / params changes to write through.

**Why:** Keeps the heavy audio (5-50 MB each) out of IndexedDB where it can hit per-store size limits and slow indexing. Keeps the small, queryable metadata (≤300 KB each) in IndexedDB where it's natively indexable and survives partial-load failures. Hybrid fingerprint avoids hashing every upload (slow) while preserving correctness when the cheap fingerprint accidentally collides.

**Cost:** Two storage backends to keep in sync; OPFS file lifecycle (create, delete, list) must be paired with IndexedDB writes carefully — orphaned audio files on crash are a real risk.

**Alternatives considered:**

- **Pure IndexedDB (analysis + audio in one store):** Simpler, but Blob storage in IndexedDB is slower than OPFS for ≥10 MB files, and per-record size can hit browser-specific soft limits.
- **Dexie (IndexedDB ORM):** ~30 KB extra dep for one object store — overkill.
- **OPFS for everything:** OPFS has no native query/index — would need to roll our own metadata index file, more error-prone than IndexedDB.

## Context for Implementer

> Write for an implementer who has never seen the codebase.

- **Patterns to follow:**
  - Zustand stores live in `src/lib/stores/`. Pattern: `create<State>((set, get) => ({ ...state, ...actions }))`. See `src/lib/stores/deep-store.ts:58` and `src/lib/stores/audio-store.ts:52` for shape.
  - Async side effects in stores: do them inside actions, don't block `set()`. See how `deep-store` does sync sets and lets the calling component handle async (`DeepMastering.tsx`).
  - Tests for stores live in `src/lib/stores/__tests__/`. Use Vitest with `beforeEach` resets.
  - API/persistence helpers go in `src/lib/storage/` (new directory) — NOT `src/lib/api/` which is for HTTP backends.
- **Conventions:**
  - File naming: kebab-case (`library-store.ts`, `library-storage.ts`, `library-fingerprint.ts`).
  - Explicit return types on all exported functions (TS strict mode is on; see `standards-typescript.md`).
  - No `any` — use `unknown` + narrowing or generics.
  - Imports: external first, then `@/...`, then relative.
- **Key files (existing):**
  - `src/lib/stores/deep-store.ts` — current in-memory deep-analysis state. `setScript` is the integration point for "save analysis."
  - `src/lib/stores/audio-store.ts` — current in-memory file/buffer/params state. `setFile`, `setParam`, `setParams` are the integration points for "save settings."
  - `src/components/upload/UploadScreen.tsx` — handles file drop. `onFilesUploaded` callback is the integration point for "check library on upload."
  - `src/app/page.tsx` — root upload page (need to verify path; likely renders UploadScreen and does the routing on file upload).
  - `src/app/master/page.tsx` — mastering page; needs to know whether the loaded file came from the library (so it can suppress redundant Analyze clicks if a script is already present).
  - `src/components/mastering/DeepMastering.tsx:140` — `setScript(script)` after backend returns. This is where the auto-save side-effect lives.
  - `src/types/deep-mastering.ts` — `MasteringScript` shape. Persisted as-is in JSON.
  - `src/types/mastering.ts` — `AudioParams` shape. Persisted as-is.
- **Gotchas:**
  - **OPFS browser support:** `navigator.storage.getDirectory()` returns a `FileSystemDirectoryHandle`. Available on Chrome/Edge 86+, Safari 15.2+, Firefox 111+. Detect with `typeof navigator?.storage?.getDirectory === "function"`. If absent, run in metadata-only mode (audio not persisted).
  - **IndexedDB in private mode (Safari):** can throw on open. Wrap library hydration in try/catch and degrade to in-memory only.
  - **`lastModified` portability:** Some download flows (e.g., Mac Finder copy) reset `lastModified`. Two genuinely different files can also share `name|size|lastModified` (rare). The collision check via SHA-256 closes this gap; fingerprint mismatch creates a new entry rather than overwriting.
  - **OPFS file delete with open handle:** must close any active `FileSystemFileHandle` before `removeEntry`, or the entry stays in directory listing on Safari.
  - **Race between `setScript` and `setFile`:** when auto-loading from library, set audio first (so engine can load buffer), then script. Otherwise DeepTimeline renders against the wrong audio.
  - **Quota:** even with 20-song cap, 20 × 50 MB = 1 GB which can hit browser quota on small devices. On `QuotaExceededError`, evict LRU once and retry; if still fails, surface user-facing error and don't add to library.
- **Domain context:**
  - "Deep analysis" = backend job (madmom + librosa + Demucs) producing a `MasteringScript` (sections, moves, stem analysis). ~50-300 KB JSON.
  - Mastering modes: simple (genre+intensity+toggles), advanced (full `AudioParams`), deep (uses `MasteringScript` to drive moves over time).
  - The library is per-origin (browser sandbox); not synced anywhere.

## Runtime Environment

- **Start command:** `pnpm dev`
- **Port:** 3000 (Next.js default)
- **Deploy path:** Cloudflare Workers (frontend) — `pnpm deploy` from project root
- **Health check:** N/A (UI app); manual smoke = upload screen renders + library list visible if entries exist
- **Restart procedure:** Hot reload during dev; redeploy via `pnpm deploy` for production

## Assumptions

- `useDeepStore.setScript(script)` is the single point where a successful analysis result lands. Confirmed by reading `DeepMastering.tsx:140`. Tasks 3, 5, 7 depend on this.
- `useAudioStore.setFile(file)` is the entry point for "this is the active audio." Confirmed by reading `audio-store.ts:62`. Tasks 5, 6 depend on this.
- `UploadScreen.onFilesUploaded` is invoked once per upload session with the user's file list. Confirmed by reading `UploadScreen.tsx:7`. Task 5 depends on this.
- The backend `MasteringScript` is content-addressable — re-running analysis on the same audio with the same profile produces equivalent results — so persisting and re-loading is semantically identical to re-analyzing. (If this is wrong, library entries are merely stale snapshots, not incorrect, and user can click "Re-analyze" to refresh.)
- Browser supports IndexedDB (mandatory) and ideally OPFS (degrades to no-audio if not). Confirmed via standard MDN compat tables for the project's documented browser support (assumed: latest Chrome/Edge/Safari/Firefox).
- The `lastModified` value on a `File` is stable across user sessions for the same physical file. If the user's OS resets it (e.g., touch), the file becomes a new library entry — acceptable (no false-positive matches).
- Mastering params from `useAudioStore` and the local `genre`/`intensity`/`toggles` state in `MasterPage` are the complete set worth persisting per song. (If `MasterPage` holds additional persistable state, Task 6 covers it.)

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| OPFS write fails mid-add → orphaned audio file or orphaned metadata row | Medium | Medium | Two-phase add: write OPFS first, then IndexedDB. On IDB failure, delete the OPFS file. On startup, run `reconcileOrphans()` — list OPFS files, drop any without a metadata row. |
| `QuotaExceededError` on insert when storage near full | Medium | High | On error: evict 1 LRU entry, retry once. If still fails, surface a user-visible error toast and reject the add. Don't crash the upload flow. |
| `lastModified` reset by OS makes user think library "lost" their song | Low | Low | Document in plan; UX accepts duplicate entry on lastModified change. Show file size + modified date in library list so user can identify duplicates. |
| Auto-load races with DeepMastering's `runAnalyze` if user clicks Analyze before hydration finishes | Low | Medium | Hydrate library entries synchronously into Zustand on UploadScreen mount, before any router push to `/master`. Block navigation until hydration completes. |
| OPFS unavailable on user's browser → audio not persisted | Medium | Low (degrade) | Detect at startup, set `useLibraryStore.audioPersistenceMode = "metadata-only"`. Library entries show "Re-upload audio to play" badge. Auto-load still hydrates script. |
| Persisting mastering params on every slider change → IndexedDB write thrash | High | Low | Debounce settings writes at 500ms in `useLibraryStore.touchSettings`. Only `setScript` writes immediately. |
| User's browser clears storage (private mode, manual clear, eviction policy) → silent data loss | Low | Low | Out of scope to defend against; documented behavior. |

## Goal Verification

### Truths

1. After analyzing a song and reloading the browser, the song appears in the library list on `/`. (Supported by Tasks 1, 3, 7.)
2. Clicking a library entry navigates to `/master` with the audio loaded, the deep-analysis script populated, and mastering settings restored — no Analyze click required. (Tasks 5, 6, 7.)
3. Uploading a file that matches an existing library entry (same fingerprint) auto-hydrates from the library and shows a "Loaded from library" badge. (Tasks 4, 5.)
4. Adding a 21st song silently evicts the least-recently-opened entry (verified: 21st entry present, originally-oldest entry absent, OPFS audio file for evicted entry deleted). (Task 2.)
5. Deleting a library entry removes both the IndexedDB row and the OPFS audio file; entry no longer appears in list after page reload. (Task 7.)
6. On a browser without OPFS support, library still works for metadata + script + settings; entries marked "Re-upload audio to play". (Task 1.)
7. TS-001 through TS-005 (E2E scenarios below) pass end-to-end. (All tasks.)

### Artifacts

- `src/lib/storage/library-storage.ts` — IndexedDB + OPFS persistence layer
- `src/lib/storage/library-fingerprint.ts` — cheap + SHA-256 fingerprint helpers
- `src/lib/stores/library-store.ts` — Zustand store
- `src/components/library/LibraryList.tsx` — UI for upload screen
- `src/lib/storage/__tests__/library-storage.test.ts`
- `src/lib/storage/__tests__/library-fingerprint.test.ts`
- `src/lib/stores/__tests__/library-store.test.ts`
- `e2e/library.spec.ts`

## E2E Test Scenarios

### TS-001: Persist analysis across reload

**Priority:** Critical
**Preconditions:** Empty library (clear IndexedDB + OPFS before run). Backend reachable for one analysis.
**Mapped Tasks:** Task 3, 5, 7

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/` | Upload screen visible; library list either absent or shows empty state |
| 2 | Drop a test WAV file (`e2e/fixtures/short-test.wav`) | Upload progress completes; navigation to `/master` |
| 3 | Switch to Deep mode; click "Analyze" | Status reaches "ready"; DeepTimeline renders moves |
| 4 | Reload the page (full browser reload of `/`) | Upload screen renders. Library list shows one entry with the WAV's filename, duration, and "analyzed" badge. |
| 5 | Click the library entry | Navigates to `/master`. Audio loads. Deep mode shows the prior script without re-analyzing (status "ready" immediately). |

### TS-002: Re-upload of known song shows Resume/Start-fresh dialog

**Priority:** Critical
**Preconditions:** TS-001 has run; library contains one entry for the test WAV; `alwaysResume` preference is unset (default).
**Mapped Tasks:** Task 4, 5

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/` | Library list shows the entry from TS-001 |
| 2 | Drop the SAME test WAV again | Modal dialog appears: title "We've seen this song before", with two buttons: "Resume saved settings" (default/highlighted) and "Start fresh", and a checkbox "Don't ask again — always resume". |
| 3 | Click "Resume saved settings" | Dialog closes; navigation to `/master`. Deep mode shows the prior script immediately (no Analyze click). "Loaded from library" badge visible. |
| 4 | Reload `/`; drop the same file again | Dialog appears again (since checkbox wasn't ticked). |
| 5 | Tick "Don't ask again — always resume", click "Resume saved settings" | Same outcome as step 3, plus preference saved. |
| 6 | Reload `/`; drop the same file again | No dialog. Auto-resumes immediately (path identical to old behavior). |
| 7 | (Separate sub-flow) Drop the file, click "Start fresh" instead | Confirmation prompt: "This will overwrite the saved analysis and settings for this song on the next Analyze. Continue?" with Cancel and "Yes, start fresh" buttons. On confirm: navigation to `/master` with empty deep-store and default mastering settings. The library entry is **not** deleted yet — only overwritten when the user runs Analyze again. |

### TS-003: LRU eviction at 21 songs

**Priority:** High
**Preconditions:** Library contains exactly 20 entries (test setup seeds them via `library-store` API).
**Mapped Tasks:** Task 2

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/` | Library list shows 20 entries |
| 2 | Add a 21st entry by uploading + analyzing a new file | Entry count remains 20. The least-recently-opened entry (deterministic from seed) is gone from the list and from OPFS (verified via `navigator.storage.getDirectory()` evaluation in test). |

### TS-004: Delete entry

**Priority:** High
**Preconditions:** Library has at least 1 entry.
**Mapped Tasks:** Task 7

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/` | Library list visible |
| 2 | Click the trash/delete icon on an entry; confirm dialog | Entry disappears from the list immediately |
| 3 | Reload `/` | Entry remains absent. (`navigator.storage.getDirectory()` shows no audio file for that fingerprint.) |

### TS-006: Multi-file upload populates library with one entry per file

**Priority:** Medium
**Preconditions:** Empty library. Two distinct test WAVs.
**Mapped Tasks:** Task 5, Task 7

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Drop two WAVs simultaneously on `/` | Existing UploadScreen handles both per `onFilesUploaded(files: File[])` (per `UploadScreen.tsx:7`). Behavior verified: today, the app likely takes only the first file since `audio-store.setFile` is single-track. If multi-file isn't supported by the navigation flow, document this in the test as a known limitation (sequential uploads work; simultaneous = first file only). |
| 2 | Analyze both files (sequentially: upload 1, analyze, navigate back, upload 2, analyze) | Both library entries exist after second analyze. |
| 3 | Reload `/` | Library shows both entries in `lastOpenedAt` desc order (most recent first). |

> **Note on simultaneous multi-file:** True simultaneous multi-file analysis (queue + parallel jobs) is OUT OF SCOPE for this plan — the existing app is single-track. This scenario verifies the library correctly accumulates across SEQUENTIAL uploads.

### TS-005: Persist & restore mastering settings

**Priority:** Medium
**Preconditions:** Empty library.
**Mapped Tasks:** Task 6

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Upload a WAV; on `/master`, set genre to "hiphop", intensity to 75, toggle "deharsh" on, change `targetLufs` slider | Params apply live |
| 2 | Run Deep Analyze (script saves) | Status "ready" |
| 3 | Reload `/`; click the library entry | `/master` opens with genre=hiphop, intensity=75, deharsh on, targetLufs at the saved value, AND deep script populated |

## Progress Tracking

- [x] Task 1: Library storage layer (IndexedDB + OPFS)
- [x] Task 2: Library Zustand store + LRU eviction
- [x] Task 3: Auto-save on `setScript` (deep analysis ready)
- [x] Task 4: File fingerprint (cheap + SHA-256 fallback)
- [x] Task 5: Auto-load on upload + UploadScreen integration
- [x] Task 6: Persist & restore mastering settings (params + simple-mode state)
- [x] Task 7: LibraryList UI component + delete action
- [x] Task 8: E2E test suite (TS-001..TS-006)

**Total Tasks:** 8 | **Completed:** 8 | **Remaining:** 0

## Implementation Tasks

### Task 1: Library storage layer (IndexedDB + OPFS)

**Objective:** Implement the low-level persistence: IndexedDB store for metadata/script/settings keyed by fingerprint, OPFS file per audio Blob. Provide a typed API: `putEntry`, `getEntry`, `listEntries`, `removeEntry`, `getAudioBlob`, `reconcileOrphans`.
**Dependencies:** None
**Mapped Scenarios:** TS-001, TS-003, TS-004

**Files:**

- Create: `src/lib/storage/library-storage.ts`
- Create: `src/lib/storage/library-types.ts`
- Test: `src/lib/storage/__tests__/library-storage.test.ts`

**Key Decisions / Notes:**

- Use `idb-keyval` as the IDB convenience layer. Add as a dep: `pnpm add idb-keyval`.
- **Two distinct IDB stores** (avoids preferences key polluting entry listings):
  - Entries store: `createStore('aurialis-library-v1', 'entries')`. Key = fingerprint string. Value = `LibraryEntry`.
  - Preferences store: `createStore('aurialis-library-v1', 'prefs')`. Key = preference name. Value = serializable.
- OPFS root subdir: `library/`. File name = `<fingerprint>.<ext>`.
- `LibraryEntry` shape:
  ```ts
  interface LibraryEntry {
    fingerprint: string;          // primary key — cheap or `cheap|sha256-prefix` after collision
    sha256: string | null;        // hex digest of audio bytes; null until first collision triggers compute
    fileName: string;
    fileSize: number;
    lastModified: number;
    mimeType: string;
    durationSec: number | null;
    createdAt: number;
    lastOpenedAt: number;
    audioPersisted: boolean;      // false in metadata-only mode
    script: MasteringScript | null;
    settings: PersistedSettings | null; // see Task 6
  }
  ```
- **Write order for `putEntry(entry, audioBlob?)`** (codifies the Risk-table mitigation):
  1. If `audioBlob && opfsAvailable`: write OPFS file `library/<fingerprint>.<ext>` first.
  2. Write IDB row.
  3. If IDB throws AND OPFS write succeeded in step 1: `await opfsRemoveEntry(fingerprint)` to compensate, then re-throw.
  4. `reconcileOrphans()` is the SAFETY NET for crash-mid-step (process killed between 1 and 2), not the primary mechanism.
- **`getAudioFile(fingerprint): Promise<File | null>`**: reads OPFS Blob and reconstructs as `new File([blob], entry.fileName, { type: entry.mimeType, lastModified: entry.lastModified })`. Used by the library-click open path (no fresh File available there). Returns `null` if OPFS unavailable or file missing.
- Detect OPFS at module load: `const opfsAvailable = typeof navigator !== "undefined" && typeof navigator.storage?.getDirectory === "function";`. If not, audio writes are no-ops and `audioPersisted: false`.
- `reconcileOrphans()` runs on app boot: list OPFS files in `library/`, list IDB entry keys, delete OPFS files with no matching IDB row.
- Wrap all IndexedDB calls in try/catch — Safari private mode throws on open. Log + return empty list / no-op writes.
- ⛔ Don't cache the OPFS dir handle across sessions — get a fresh handle per call (cheap; avoids stale handle bugs).
- `listEntries()` reads only the `entries` store; preferences store is queried via `getPreference`/`setPreference`.

**Definition of Done:**

- [ ] All unit tests pass (mock IDB via `fake-indexeddb`; mock OPFS via in-memory adapter)
- [ ] `putEntry` + `getEntry` round-trip a `LibraryEntry` with full fidelity (deep equality including envelope arrays)
- [ ] `getAudioBlob(fingerprint)` returns the exact bytes that were written
- [ ] `getAudioFile(fingerprint)` returns a `File` with the original `name`, `type`, and `lastModified`
- [ ] `removeEntry(fingerprint)` deletes both IDB row and OPFS file
- [ ] **Two-phase write atomicity**: simulated IDB throw after successful OPFS write triggers OPFS compensation delete (no orphan)
- [ ] `reconcileOrphans()` removes OPFS files with no IDB row, leaves matched files alone
- [ ] `listEntries()` does NOT return preferences (asserted via test that puts a preference and verifies entries list is empty)
- [ ] OPFS-unavailable mode: all writes succeed, `audioPersisted: false` on all entries, `getAudioBlob` returns `null`
- [ ] No diagnostics errors

**Verify:**

- `pnpm test src/lib/storage/__tests__/library-storage.test.ts`

### Task 2: Library Zustand store + LRU eviction

**Objective:** Wrap `library-storage` in a `useLibraryStore` Zustand store that hydrates on creation, exposes reactive `entries`, and enforces 20-song cap with LRU eviction on `addEntry`.
**Dependencies:** Task 1
**Mapped Scenarios:** TS-003

**Files:**

- Create: `src/lib/stores/library-store.ts`
- Test: `src/lib/stores/__tests__/library-store.test.ts`

**Key Decisions / Notes:**

- State: `entries: LibraryEntry[]` (sorted by `lastOpenedAt` desc), `preferences: { alwaysResume: boolean }`, `audioPersistenceMode: "full" | "metadata-only"`, `hydrated: boolean`.
- Actions: `hydrate()`, `addEntry(file, opts)`, `openEntry(fingerprint)` (touch + return entry), `removeEntry(fingerprint)`, `updateScript(fingerprint, script)`, `updateSettings(fingerprint, settings)`, `setPreference(key, value)`, `flushPendingWrites()`.
- LRU: `addEntry` checks `entries.length >= 20`. If so, evict via the loop below BEFORE the put.
- **Quota / eviction loop on `QuotaExceededError`**:
  1. Identify LRU candidates: entries sorted by `lastOpenedAt` asc, EXCLUDING any entry touched within the last 5 seconds (avoid evicting whatever the user just opened).
  2. Evict one candidate (atomic — both OPFS file and IDB row, via `removeEntry`).
  3. Retry the original `putEntry`. On further `QuotaExceededError`, repeat steps 1-2 up to 3 times total.
  4. After 3 failed evictions: do NOT partial-commit (use the two-phase rollback in Task 1's `putEntry`). Surface the error to the caller; `addEntry` returns `{ ok: false, reason: "quota" }`. The upload UI shows a non-blocking error toast.
- `openEntry` updates `lastOpenedAt = Date.now()`, persists the touch, re-sorts.
- Hydrate via explicit `hydrate()` called from a top-level client provider component (e.g., a new `<LibraryProvider>` in `src/app/providers.tsx` or wherever root client wrappers live; verify by reading `app/layout.tsx`).
- **Debounced settings writes**: `updateSettings(fingerprint, snapshot)` schedules a 500ms `setTimeout` keyed by fingerprint, replacing any pending timer for the same fingerprint. The timer's callback calls the underlying `library-storage.putEntry`.
- **`flushPendingWrites()`**: synchronously fires every pending debounced timer, awaits all writes. Bound to `pagehide` and `visibilitychange→hidden` events at hydrate time so the final slider tweak is never lost when the user closes the tab.
- ⛔ Performance: action implementations must NOT recompute `entries` array from scratch on every settings update — mutate in place via `set((s) => ({ entries: s.entries.map(e => e.fingerprint === fp ? {...e, settings} : e) }))` (still immutable, but O(N) once).

**Definition of Done:**

- [ ] All unit tests pass
- [ ] Hydration loads entries from storage and sorts by `lastOpenedAt` desc
- [ ] `addEntry` enforces 20-song cap; evicted entry is gone from both store state and storage
- [ ] `openEntry` bumps `lastOpenedAt` and persists; subsequent eviction order reflects the bump
- [ ] `updateSettings` debounces — 10 calls within 500ms result in 1 storage write
- [ ] **Quota loop**: simulated `QuotaExceededError` triggers up to 3 evictions; succeeds when room available, returns `{ ok: false, reason: "quota" }` when no candidates left
- [ ] **Recently-touched protection**: an entry touched within the last 5s is NOT eligible for eviction even if it has the smallest `lastOpenedAt` (test seeds + immediately calls openEntry)
- [ ] **Flush on pagehide**: a pending debounced write is forced to disk when `pagehide` event fires (verified via mock Event + spy on `library-storage.putEntry`)
- [ ] `setPreference("alwaysResume", true)` persists to the prefs store and survives `hydrate()`
- [ ] No diagnostics errors

**Verify:**

- `pnpm test src/lib/stores/__tests__/library-store.test.ts`

### Task 3: Auto-save on `setScript` (deep analysis ready)

**Objective:** When `useDeepStore.setScript` is called with a non-null script and the active file is in `useAudioStore`, write the entry to the library (creating it if new, updating its script if existing).
**Dependencies:** Task 1, Task 2, Task 4 (fingerprint)
**Mapped Scenarios:** TS-001

**Files:**

- Modify: `src/lib/stores/deep-store.ts` (add side-effect to `setScript`)
- Test: `src/lib/stores/__tests__/deep-store.test.ts` (extend)

**Key Decisions / Notes:**

- Side effect lives in the action, not in components. Pattern: `setScript: (s) => { set({ script: s }); if (s) void persistScriptToLibrary(s); }`.
- `persistScriptToLibrary` reads `useAudioStore.getState().file` and `useLibraryStore.getState()`. If file missing, no-op (script can't be associated). If fingerprint exists, `updateScript`. If new, `addEntry({ file, script })`.
- Fingerprint computed via `Task 4`'s helper. SHA-256 path may need to be awaited, so `setScript` itself stays sync (set state immediately) and the persistence is fire-and-forget.
- Errors are logged, not thrown — losing a save is annoying but shouldn't break the app.

**Definition of Done:**

- [ ] `setScript(script)` with file present → entry exists in library after the next tick
- [ ] `setScript(null)` is a no-op for persistence
- [ ] Re-analyzing the same file (same fingerprint) updates the existing entry's `script`, doesn't create a duplicate
- [ ] No diagnostics errors

**Verify:**

- `pnpm test src/lib/stores/__tests__/deep-store.test.ts`

### Task 4: File fingerprint (cheap + SHA-256 collision resolution)

**Objective:** Implement fingerprint helpers that disambiguate two genuinely different files with identical `name|size|lastModified`. Use cheap fingerprint as the primary key; on apparent collision, compute SHA-256 of the new file's bytes and compare against the stored entry's `sha256` field (computing it on first collision if absent).
**Dependencies:** None
**Mapped Scenarios:** TS-002

**Files:**

- Create: `src/lib/storage/library-fingerprint.ts`
- Test: `src/lib/storage/__tests__/library-fingerprint.test.ts`

**Key Decisions / Notes:**

- Public API:
  - `cheapFingerprint(file): string` — `${file.name}|${file.size}|${file.lastModified}`. Pure, sync, ~1µs.
  - `contentFingerprint(file): Promise<string>` — SHA-256 hex via `crypto.subtle.digest("SHA-256", await file.arrayBuffer())`.
  - `composeFingerprint(cheap: string, sha256: string): string` — `${cheap}|${sha256.slice(0, 16)}`. Used as the entry key for the SECOND distinct file with the same cheap fingerprint.
- **Collision resolution contract** (called from `library-store.addEntry`):
  1. Compute `cheap = cheapFingerprint(file)`.
  2. Look up existing entry by `cheap`. If none: use `cheap` as the fingerprint, store `sha256: null` (lazy — never compute unless needed).
  3. If existing entry found: compute `newSha = contentFingerprint(file)`. If existing entry has `sha256 == null`: lazily compute `existingSha = contentFingerprint(getAudioFile(cheap))` and write it back to the entry. If `newSha === existingSha`: same song — return the existing entry (resume path). If they differ: this is a true collision — use `composeFingerprint(cheap, newSha)` as the new entry's fingerprint and add as a distinct entry.
  4. The second collision and beyond also use `composeFingerprint`, so collision keys are stable.
- File size cap on SHA-256: our 50 MB per entry is fine for one-shot `arrayBuffer()`. Document that files >100 MB would need streaming digest (out of scope).

**Definition of Done:**

- [ ] `cheapFingerprint` is deterministic and pure
- [ ] `contentFingerprint` produces SHA-256 hex matching `openssl dgst -sha256` on the same bytes
- [ ] `composeFingerprint` is deterministic and reversible (cheap and sha256-prefix recoverable for diagnostics)
- [ ] Both functions handle empty files and large (10 MB) files
- [ ] **Collision test**: two `File` objects with identical name/size/lastModified but different content produce two distinct fingerprints when run through the addEntry resolution flow; the older entry has its `sha256` field lazily filled in
- [ ] No diagnostics errors

**Verify:**

- `pnpm test src/lib/storage/__tests__/library-fingerprint.test.ts`

### Task 5: Resume-or-start-fresh on upload + UploadScreen integration

**Objective:** When a user uploads a file, compute its fingerprint and look up the library. If a match is found AND `preferences.alwaysResume === true`: hydrate stores and navigate (silent resume). If a match is found AND `alwaysResume` is unset: show a Resume/Start-fresh dialog with a "Don't ask again" checkbox; on Resume, hydrate + navigate; on Start fresh, show a confirmation warning, then proceed with empty stores. If no match: existing analyze flow. Pass `loadedFromLibrary` flag so `MasterPage` shows the badge.
**Dependencies:** Task 2, Task 4
**Mapped Scenarios:** TS-001 step 5, TS-002

**Files:**

- Modify: `src/components/upload/UploadScreen.tsx` (call library lookup before `onFilesUploaded`)
- Modify: `src/app/page.tsx` (or wherever `onFilesUploaded` is wired) — handle the dialog + hydrate path
- Modify: `src/app/master/page.tsx` (consume the flag, render badge)
- Create: `src/components/library/ResumeOrFreshDialog.tsx` (the modal — uses existing `@radix-ui/react-dialog`)
- Modify: `src/lib/stores/library-store.ts` (add `preferences: { alwaysResume: boolean }`, persisted)
- Test: `src/components/upload/__tests__/UploadScreen.test.tsx` (extend or create)
- Test: `src/components/library/__tests__/ResumeOrFreshDialog.test.tsx`

**Key Decisions / Notes:**

- Lookup logic in a small helper `tryLoadFromLibrary(file): Promise<LibraryEntry | null>` to keep `UploadScreen` thin.
- Flag for "loaded from library": pass via Zustand (`useDeepStore.loadedFromLibrary: boolean`, transient) rather than URL param. Reset on next user-initiated re-analyze.
- Badge text: "Loaded from library — re-analyze to refresh."
- `ResumeOrFreshDialog` is a controlled component receiving `entry` and `onChoice("resume" | "fresh")`. Parent owns the open state and the post-choice navigation.
- "Start fresh" path uses a second confirm step (browser-native `confirm()` is fine — matches existing pattern in `DeepMastering.tsx:196` profile-switch guard).
- Resume vs fresh paths:
  - **Resume (CORRECT ORDER — settings before file to avoid engine-init-with-defaults):**
    1. `setSettings(entry.settings)` — populate `useAudioStore.params` and the simple-mode state in MasterPage's hydration helper. Stores updated while no engine is running yet.
    2. `setScript(entry.script, { skipPersist: true })` (deep-store) — skip the auto-save side effect (Task 3) so we don't double-touch.
    3. `setProfile(entry.script.profile)`.
    4. `setLoadedFromLibrary(true)` (deep-store transient flag — gates the badge).
    5. `setFile(file)` LAST. The audio engine's `useEffect` watching `file` then runs `loadFile`, instantiating with the already-restored params on first read.
    6. `useLibraryStore.openEntry(fingerprint)` (touch `lastOpenedAt`).
    7. Navigate to `/master`. Badge visible. For the upload path use the freshly-uploaded `File`. For the library-click path (Task 7), call `library-storage.getAudioFile(fingerprint)` to reconstruct a `File` from the OPFS Blob.
  - **Start fresh (no implicit overwrite until Analyze runs):**
    1. `setFile(file)` only — don't touch deep-store / settings; they remain at defaults.
    2. **Do not** delete the library entry. It stays accessible from the library list with its OLD script intact.
    3. **Suppress library auto-update on transient settings changes while in this state.** Set a `useDeepStore.suppressLibraryAutoUpdate = true` flag on Start fresh; clear it when the user clicks Analyze (next `setScript` lands and Task 3's update fires). Settings touches during Start fresh do NOT call `useLibraryStore.updateSettings`.
    4. Navigate to `/master`, no badge. Show a small banner: "Working on a fresh version — Analyze to overwrite the saved version."
    5. Library entry's saved script + settings remain visible from `/` until the user clicks Analyze and the new script overwrites.
- `preferences.alwaysResume` lives in `useLibraryStore` and persists in IndexedDB (separate key `__preferences__`). When `true`, skip the dialog entirely on match.

**Definition of Done:**

- [ ] Upload of unknown file behaves as before (analyze flow unchanged)
- [ ] Upload of known file (alwaysResume=false) shows the Resume/Fresh dialog
- [ ] Resume button hydrates stores from library, navigates to `/master`, badge visible
- [ ] Resume restore order verified: AudioEngine instantiates with restored params on first init — no default-then-restore transition observable in metering or params snapshot
- [ ] Start fresh shows the overwrite-warning confirm; on confirm, navigates to `/master` with empty stores; library entry remains intact (verifiable via `listEntries`)
- [ ] After Start fresh, navigating back to `/` shows the library entry with its ORIGINAL script and settings intact until the user clicks Analyze and the new script lands
- [ ] During Start fresh on `/master`, slider changes do NOT update the library entry (settings auto-save suppressed via flag)
- [ ] "Don't ask again" checkbox persists to `preferences.alwaysResume` and survives reload
- [ ] Upload of known file with alwaysResume=true skips dialog, behaves like Resume
- [ ] `lastOpenedAt` for the matched entry is bumped only on Resume (not on Start fresh)
- [ ] Library-click open path reconstructs a File via `getAudioFile(fingerprint)` and successfully populates the audio engine
- [ ] Component tests pass
- [ ] No diagnostics errors

**Verify:**

- `pnpm test src/components/upload/__tests__/UploadScreen.test.tsx`
- `pnpm test src/app/master` (if applicable)

### Task 6: Persist & restore mastering settings

**Objective:** Persist the user's mastering settings per library entry: `useAudioStore.params` (full `AudioParams`), simple-mode `genre`/`intensity`/`toggles`, `tonePreset`, `outputPreset`. Restore on auto-load. Hooked via debounced writes whenever the relevant state changes.
**Dependencies:** Task 1, Task 2, Task 4
**Mapped Scenarios:** TS-005

**Files:**

- Create: `src/lib/storage/library-settings.ts` (PersistedSettings type + helpers)
- Modify: `src/lib/stores/audio-store.ts` (subscribe params changes → debounced library write)
- Modify: `src/app/master/page.tsx` (subscribe simple-mode state changes → debounced library write; restore on mount when `loadedFromLibrary`)
- Test: `src/lib/storage/__tests__/library-settings.test.ts`

**Key Decisions / Notes:**

- `PersistedSettings` shape:
  ```ts
  interface PersistedSettings {
    params: AudioParams;
    simple: { genre: GenreName; intensity: number; toggles: Record<ToggleName, boolean> };
    tonePreset: TonePresetName | null;
    outputPreset: OutputPresetName | null;
    savedAt: number;
  }
  ```
- Subscription pattern: in `MasterPage`, `useEffect` with deps on the settings state. Call `useLibraryStore.getState().updateSettings(currentFingerprint, snapshot)`. The store debounces (Task 2). Skip the call when `useDeepStore.suppressLibraryAutoUpdate === true` (Start-fresh state).
- **Restore happens in Task 5 BEFORE setFile is called** — not in MasterPage's mount. This is the only reliable way to ensure the AudioEngine's first read of params sees restored values, not defaults. MasterPage need not do anything special on mount; the stores are already populated.
- ⛔ Performance: only subscribe to slices that should trigger persistence. Don't subscribe to playback state (currentTime, isPlaying) — those aren't settings.
- Don't persist transient state: `metering`, `currentTime`, `isPlaying`, `isExporting`.
- **Flush-on-unload integration**: `useLibraryStore.flushPendingWrites()` is bound to `pagehide` and `visibilitychange→hidden` at hydrate time (Task 2). The MasterPage subscription itself does nothing extra — the store's debounce timers are flushed by the global hook.

**Definition of Done:**

- [ ] Changing a slider on `/master` results in 1 library write within 500ms (debounced)
- [ ] Reload + re-open from library restores the exact slider value
- [ ] Simple-mode state (genre/intensity/toggles) restores correctly
- [ ] Restore happens BEFORE setFile in Task 5 — engine reads restored params on first init
- [ ] **Flush-on-unload**: slider change followed within 500ms by tab close persists the final value (verified via Playwright `page.context().close()` between mutation and re-open)
- [ ] During Start fresh state (`suppressLibraryAutoUpdate=true`), slider changes do NOT call `updateSettings` (verified via spy)
- [ ] No diagnostics errors

**Verify:**

- `pnpm test src/lib/storage/__tests__/library-settings.test.ts`

### Task 7: LibraryList UI component + delete action

**Objective:** Render the list of library entries below the drop zone on `/`. Each row shows file name, duration, modified date, "analyzed ✓" badge, click-to-open, and a delete button with confirm.
**Dependencies:** Task 2
**Mapped Scenarios:** TS-001 step 4, TS-004

**Files:**

- Create: `src/components/library/LibraryList.tsx`
- Create: `src/components/library/LibraryRow.tsx`
- Create: `src/components/library/__tests__/LibraryList.test.tsx`
- Modify: `src/app/page.tsx` (or wherever UploadScreen is hosted) — render `<LibraryList />` below `<UploadScreen />`

**Key Decisions / Notes:**

- Empty state (0 entries): render nothing (don't add visual noise to the upload screen).
- 1+ entries: render a small section header "Your library" + the rows.
- Row layout: filename (truncate), duration (mm:ss), modified date (relative), "Loaded ✓" badge if `script != null`, delete icon.
- Click row → call `onOpenLibraryEntry(fingerprint)` prop, which the parent wires to `tryLoadFromLibrary` + navigate.
- Delete: confirm dialog (use existing `@radix-ui/react-dialog`). On confirm, `useLibraryStore.removeEntry(fingerprint)`.
- Style: matches existing dark theme (see UploadScreen for pattern). Use existing Tailwind tokens (`text-[rgba(255,255,255,0.7)]`, `border-[rgba(255,255,255,0.06)]`).
- ⛔ Performance: rows should be memoized (`React.memo`) — adding/removing one entry shouldn't re-render all 20.
- Accessibility: each row is a `<button>`, delete is a separate `<button>` with `aria-label="Delete <filename>"`.

**Definition of Done:**

- [ ] LibraryList renders 0 entries as nothing (no header)
- [ ] LibraryList renders N entries in `lastOpenedAt` desc order
- [ ] Click on row fires the open callback with the correct fingerprint
- [ ] Delete with confirm removes from list immediately + persists removal
- [ ] Component tests pass
- [ ] No diagnostics errors
- [ ] Keyboard navigable (Tab to row, Enter to open, separate Tab to delete)

**Verify:**

- `pnpm test src/components/library/__tests__/LibraryList.test.tsx`

### Task 8: E2E test suite (TS-001..TS-005)

**Objective:** Implement Playwright tests for the five E2E scenarios above. Tests must clear browser storage between runs, use a fixture WAV that's small enough to analyze in <30 s, and verify both UI state and underlying storage state via `page.evaluate`.
**Dependencies:** All previous tasks
**Mapped Scenarios:** TS-001..TS-005

**Files:**

- Create: `e2e/library.spec.ts`
- Modify: `e2e/fixtures/` — add a small WAV if `short-test.wav` not already present
- Modify: `playwright.config.ts` — add fingerprint to ensure storage is cleared per test (verify existing setup; may already be in place)

**Key Decisions / Notes:**

- Cleanup helper in `e2e/helpers/library-cleanup.ts`. Each step wrapped in try/catch — `removeEntry` throws `NotFoundError` on first run (no `library/` dir yet); `indexedDB.deleteDatabase` blocks if a connection is open. Helper resolves on success, NotFoundError, or BlockedError.
  ```ts
  // Pseudo:
  await page.evaluate(async () => {
    try { (await navigator.storage.getDirectory()).removeEntry('library', { recursive: true }); } catch (e) { if ((e as Error).name !== 'NotFoundError') throw e; }
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('aurialis-library-v1');
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  });
  ```
- Fixture WAV: pick or generate a 10-15 second mono WAV at 44.1 kHz. Backend should handle it fast enough; if backend is unavailable in CI, mock the deep-analysis endpoints (existing pattern in repo per `e2e/` tests, verify via reading existing E2E file).
- For TS-003 (LRU), seed via `page.evaluate(async () => { /* call useLibraryStore.getState().addEntry 20 times */ })` to skip 20 actual analyses.
- For TS-005, set sliders via accessible roles + verify persisted values via `page.evaluate(() => indexedDB...)`.
- Use the existing `__aurialisAudioStore` window hook (see `audio-store.ts:98`) for state inspection. Add a `__aurialisLibraryStore` hook in `library-store.ts` mirroring this pattern.

**Definition of Done:**

- [ ] All 6 scenarios (TS-001..TS-006) pass locally (`pnpm test:e2e e2e/library.spec.ts`)
- [ ] Tests are independent (each can run alone)
- [ ] `beforeEach` cleanup succeeds on a fresh browser context with no prior storage (NotFoundError handled)
- [ ] No flaky waits — use `page.waitFor*` with conditions, not arbitrary timeouts
- [ ] No diagnostics errors

**Verify:**

- `pnpm test:e2e e2e/library.spec.ts`

## Open Questions

None at planning time.

## E2E Results

| Scenario | Priority | Result | Fix Attempts | Notes |
|----------|----------|--------|--------------|-------|
| TS-001   | Critical | PASS   | 0            | Persist + reload, library list visible after reload, badge on library-click open |
| TS-002   | Critical | PASS   | 0            | Resume/Fresh dialog appears on cheap-fingerprint match |
| TS-002b  | Critical | PASS   | 0            | "Don't ask again" preference persists; subsequent matches skip dialog |
| TS-003   | High     | PASS   | 1            | Initially failed: hydrate's reconcileOrphans raced with addEntry's eviction (browser OPFS removeEntry returned NoModificationAllowedError on concurrent dir iteration). Fix: await reconcileOrphans inside hydrate. |
| TS-004   | High     | PASS   | 0            | Delete with confirm removes IDB row + OPFS file; gone after reload |
| TS-005   | Medium   | PASS   | 0            | Slider change → debounced library write; targetLufs persists |
| TS-006   | Medium   | PASS   | 0            | Sequential uploads accumulate; sorted by lastOpenedAt desc |
| Live (Playwright vs `pnpm dev`) | Smoke | PASS | 1 | Manually exercised library + Resume/Fresh dialog + delete in real Chrome. Surfaced one real-browser bug missed by the mocked E2E: OPFS `removeEntry` fails with `InvalidStateError` / `NoModificationAllowedError` if a stale `FileSystemFileHandle` lingers. Fix: `opfsRemove` now logs + ignores those two error names; `reconcileOrphans` cleans up next boot. Verified delete works after fix. |

### Deferred Ideas

- Storage usage gauge in the UI (e.g., "12/20 songs · 340 MB").
- Bulk export of library (zip of audio + JSON).
- Search / filter on library list (only useful if cap raises beyond ~20).
- Cross-device sync (would require a server backend — adjacent to the broader auth/server roadmap).
- Persist Stem MixerStore state alongside Deep Mastering (separate plan; out of scope here).
