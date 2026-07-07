import { describe, it, expect, vi } from "vitest";
import {
  masterAlbum,
  wavFileName,
  type MasterAlbumDeps,
  type AlbumMasterProgress,
} from "../master-album";

function makeDeps(overrides: Partial<MasterAlbumDeps> = {}): {
  deps: MasterAlbumDeps;
  buildZip: ReturnType<typeof vi.fn>;
  download: ReturnType<typeof vi.fn>;
} {
  const buildZip = vi.fn(async () => new Blob(["zip"]));
  const download = vi.fn();
  const deps: MasterAlbumDeps = {
    renderTrack: vi.fn(async () => new ArrayBuffer(8)),
    buildZip,
    download,
    ...overrides,
  };
  return { deps, buildZip, download };
}

const tracks = [
  { id: "a", title: "Alpha" },
  { id: "b", title: "Beta" },
  { id: "c", title: "Gamma" },
];

describe("wavFileName", () => {
  it("appends .wav and sanitizes illegal characters", () => {
    expect(wavFileName("My/Track:1", new Set())).toBe("MyTrack1.wav");
  });

  it("dedupes repeated titles", () => {
    const used = new Set<string>();
    expect(wavFileName("Song", used)).toBe("Song.wav");
    expect(wavFileName("Song", used)).toBe("Song (2).wav");
    expect(wavFileName("Song", used)).toBe("Song (3).wav");
  });

  it("falls back to 'track' for empty/blank titles", () => {
    expect(wavFileName("   ", new Set())).toBe("track.wav");
  });
});

describe("masterAlbum", () => {
  it("renders every track, zips once, downloads with the given name", async () => {
    const { deps, buildZip, download } = makeDeps();
    const result = await masterAlbum(deps, {
      tracks,
      targetLufs: -14,
      zipName: "My Album — mastered.zip",
    });
    expect(deps.renderTrack).toHaveBeenCalledTimes(3);
    expect(buildZip).toHaveBeenCalledOnce();
    expect(buildZip.mock.calls[0]![0]).toHaveLength(3);
    expect(download).toHaveBeenCalledWith(expect.any(Blob), "My Album — mastered.zip");
    expect(result).toMatchObject({ phase: "done", succeeded: 3, failed: 0, downloaded: true });
  });

  it("passes the album target through to each render", async () => {
    const { deps } = makeDeps();
    await masterAlbum(deps, { tracks, targetLufs: -9, zipName: "x.zip" });
    for (const call of (deps.renderTrack as ReturnType<typeof vi.fn>).mock.calls) {
      expect(call[1]).toBe(-9);
    }
  });

  it("surfaces a per-track error without aborting the batch", async () => {
    const renderTrack = vi.fn(async (t: { id: string }) => {
      if (t.id === "b") throw new Error("decode failed");
      return new ArrayBuffer(8);
    });
    const { deps, buildZip } = makeDeps({ renderTrack });
    const result = await masterAlbum(deps, { tracks, targetLufs: -14, zipName: "x.zip" });
    expect(renderTrack).toHaveBeenCalledTimes(3); // did not abort
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(1);
    expect(buildZip.mock.calls[0]![0]).toHaveLength(2); // only successes zipped
    const bad = result.tracks.find((t) => t.id === "b")!;
    expect(bad.status).toBe("error");
    expect(bad.error).toBe("decode failed");
  });

  it("stops after the current track when cancelled and still ships partial work", async () => {
    let processed = 0;
    const renderTrack = vi.fn(async () => {
      processed += 1;
      return new ArrayBuffer(8);
    });
    const { deps, buildZip, download } = makeDeps({ renderTrack });
    // Cancel once the first track is done.
    const isCancelled = () => processed >= 1;
    const result = await masterAlbum(deps, {
      tracks,
      targetLufs: -14,
      zipName: "x.zip",
      isCancelled,
    });
    expect(renderTrack).toHaveBeenCalledTimes(1);
    expect(result.phase).toBe("cancelled");
    expect(result.succeeded).toBe(1);
    // partial work still zipped + downloaded
    expect(buildZip).toHaveBeenCalledOnce();
    expect(download).toHaveBeenCalledOnce();
    expect(result.downloaded).toBe(true);
  });

  it("does not zip or download when every track fails", async () => {
    const renderTrack = vi.fn(async () => {
      throw new Error("nope");
    });
    const { deps, buildZip, download } = makeDeps({ renderTrack });
    const result = await masterAlbum(deps, { tracks, targetLufs: -14, zipName: "x.zip" });
    expect(buildZip).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
    expect(result).toMatchObject({ phase: "done", succeeded: 0, failed: 3, downloaded: false });
  });

  it("returns empty phase with no work for zero tracks", async () => {
    const { deps, buildZip, download } = makeDeps();
    const result = await masterAlbum(deps, { tracks: [], targetLufs: -14, zipName: "x.zip" });
    expect(result.phase).toBe("empty");
    expect(deps.renderTrack).not.toHaveBeenCalled();
    expect(buildZip).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  it("emits progress transitions: queued → rendering → done, plus zipping and done", async () => {
    const phases: AlbumMasterProgress["phase"][] = [];
    const statuses: string[][] = [];
    const { deps } = makeDeps();
    await masterAlbum(deps, {
      tracks,
      targetLufs: -14,
      zipName: "x.zip",
      onProgress: (p) => {
        phases.push(p.phase);
        statuses.push(p.tracks.map((t) => t.status));
      },
    });
    expect(phases).toContain("running");
    expect(phases).toContain("zipping");
    expect(phases.at(-1)).toBe("done");
    // final snapshot: all done
    expect(statuses.at(-1)).toEqual(["done", "done", "done"]);
    // an intermediate snapshot shows a track mid-render
    expect(statuses.some((s) => s.includes("rendering"))).toBe(true);
  });

  it("reports a fraction that climbs to 1 by completion", async () => {
    const fractions: number[] = [];
    const { deps } = makeDeps();
    await masterAlbum(deps, {
      tracks,
      targetLufs: -14,
      zipName: "x.zip",
      onProgress: (p) => fractions.push(p.fraction),
    });
    expect(Math.min(...fractions)).toBeGreaterThanOrEqual(0);
    expect(fractions.at(-1)).toBe(1);
  });
});
