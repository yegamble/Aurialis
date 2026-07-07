/**
 * Pure orchestration for "Master entire album" — a cancellable per-track queue
 * that renders each analyzed track, collects the encoded WAVs, zips them, and
 * hands the archive to a downloader.
 *
 * All side-effecting work (render+encode, zip, download) is injected via
 * `MasterAlbumDeps` so this module is deterministic and unit-testable without a
 * browser AudioContext, JSZip, or the DOM. The page wires the real deps.
 */

/** Per-track lifecycle state. */
export type AlbumTrackPhase = "queued" | "rendering" | "done" | "error";

/** Overall run phase. */
export type AlbumMasterPhase =
  | "running"
  | "zipping"
  | "done"
  | "cancelled"
  | "empty";

export interface AlbumTrackInput {
  /** Library fingerprint / stable id. */
  id: string;
  /** Display title (also seeds the WAV filename inside the ZIP). */
  title: string;
}

export interface AlbumTrackState {
  id: string;
  title: string;
  status: AlbumTrackPhase;
  /** Human-readable error when `status === "error"`. */
  error?: string;
}

export interface AlbumMasterProgress {
  tracks: AlbumTrackState[];
  /** Tracks finished (done + error). */
  completed: number;
  total: number;
  /** 0..1 across the whole run (render fills to 1, zipping/done pin at 1). */
  fraction: number;
  phase: AlbumMasterPhase;
}

export interface RenderedTrack {
  /** Filename inside the ZIP (already deduped + sanitized). */
  name: string;
  data: ArrayBuffer;
}

export interface MasterAlbumDeps {
  /**
   * Render + encode a single track to a WAV ArrayBuffer, applying its persisted
   * mastering chain with the album target override. Throws on failure — the
   * batch records the error and keeps going.
   */
  renderTrack: (track: AlbumTrackInput, targetLufs: number) => Promise<ArrayBuffer>;
  /** Bundle the encoded WAVs into a single archive Blob. */
  buildZip: (files: RenderedTrack[]) => Promise<Blob>;
  /** Trigger the archive download. */
  download: (blob: Blob, filename: string) => void;
}

export interface MasterAlbumOptions {
  tracks: AlbumTrackInput[];
  /** Album loudness target (LUFS) applied to every track's chain. */
  targetLufs: number;
  /** Suggested archive filename, e.g. "My Album — mastered.zip". */
  zipName: string;
  /** Progress callback fired on every state transition. */
  onProgress?: (progress: AlbumMasterProgress) => void;
  /** Polled between tracks; return true to stop after the current track. */
  isCancelled?: () => boolean;
}

export interface MasterAlbumResult {
  phase: "done" | "cancelled" | "empty";
  succeeded: number;
  failed: number;
  /** True when a ZIP was produced and handed to the downloader. */
  downloaded: boolean;
  tracks: AlbumTrackState[];
}

/** Sanitize a track title into a unique `.wav` filename within the archive. */
export function wavFileName(title: string, used: Set<string>): string {
  const cleaned = title
    .replace(/[/\\?%*:|"<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const base = cleaned.length > 0 ? cleaned : "track";
  let name = `${base}.wav`;
  let n = 2;
  while (used.has(name)) {
    name = `${base} (${n}).wav`;
    n += 1;
  }
  used.add(name);
  return name;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : "Render failed";
}

/**
 * Run the album-master batch. Renders tracks sequentially so memory stays
 * bounded; per-track errors are captured without aborting the run; cancellation
 * is honoured between tracks. Any successfully-rendered tracks are still zipped
 * and downloaded, even on cancel, so partial work is never wasted.
 */
export async function masterAlbum(
  deps: MasterAlbumDeps,
  options: MasterAlbumOptions,
): Promise<MasterAlbumResult> {
  const { tracks, targetLufs, zipName, onProgress, isCancelled } = options;
  const total = tracks.length;
  const states: AlbumTrackState[] = tracks.map((t) => ({
    id: t.id,
    title: t.title,
    status: "queued",
  }));

  const snapshot = (phase: AlbumMasterPhase): void => {
    if (!onProgress) return;
    const completed = states.filter(
      (s) => s.status === "done" || s.status === "error",
    ).length;
    const fraction =
      total === 0 ? 1 : phase === "zipping" || phase === "done" ? 1 : completed / total;
    onProgress({
      tracks: states.map((s) => ({ ...s })),
      completed,
      total,
      fraction,
      phase,
    });
  };

  if (total === 0) {
    snapshot("empty");
    return { phase: "empty", succeeded: 0, failed: 0, downloaded: false, tracks: states };
  }

  const rendered: RenderedTrack[] = [];
  const usedNames = new Set<string>();
  let cancelled = false;

  snapshot("running");

  for (let i = 0; i < total; i += 1) {
    if (isCancelled?.()) {
      cancelled = true;
      break;
    }
    const state = states[i]!;
    const track = tracks[i]!;
    state.status = "rendering";
    snapshot("running");
    try {
      const data = await deps.renderTrack(track, targetLufs);
      rendered.push({ name: wavFileName(track.title, usedNames), data });
      state.status = "done";
    } catch (err) {
      state.status = "error";
      state.error = errorMessage(err);
    }
    snapshot("running");
  }

  const succeeded = rendered.length;
  const failed = states.filter((s) => s.status === "error").length;

  let downloaded = false;
  if (succeeded > 0) {
    snapshot("zipping");
    const blob = await deps.buildZip(rendered);
    deps.download(blob, zipName);
    downloaded = true;
  }

  const phase: "done" | "cancelled" = cancelled ? "cancelled" : "done";
  snapshot(phase);
  return { phase, succeeded, failed, downloaded, tracks: states };
}
