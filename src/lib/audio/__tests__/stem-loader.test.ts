import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  loadStemsFromFiles,
  loadStemsFromZip,
  isZipFile,
  generateWaveformPeaks,
} from "../stem-loader";

// Mock JSZip
vi.mock("jszip", () => {
  const mockAsync = vi.fn();
  const mockForEach = vi.fn();

  return {
    default: vi.fn().mockImplementation(() => ({
      loadAsync: mockAsync,
      forEach: mockForEach,
    })),
  };
});

// Helper: create a minimal mock AudioBuffer
function createMockAudioBuffer(
  duration = 2,
  sampleRate = 44100,
  channels = 2
): AudioBuffer {
  const length = Math.floor(duration * sampleRate);
  const channelData = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    channelData[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate);
  }

  return {
    duration,
    sampleRate,
    numberOfChannels: channels,
    length,
    getChannelData: vi.fn().mockReturnValue(channelData),
    copyFromChannel: vi.fn(),
    copyToChannel: vi.fn(),
  } as unknown as AudioBuffer;
}

// Helper: create a File with a working arrayBuffer method
function makeFile(name: string, type: string, content = "data"): File {
  const blob = new Blob([content], { type });
  return new File([blob], name, { type });
}

// Mock AudioContext
function createMockAudioContext(): AudioContext {
  const mockBuffer = createMockAudioBuffer();
  return {
    sampleRate: 44100,
    decodeAudioData: vi.fn().mockResolvedValue(mockBuffer),
  } as unknown as AudioContext;
}

describe("stem-loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isZipFile", () => {
    it("detects .zip extension", () => {
      expect(isZipFile(makeFile("stems.zip", ""))).toBe(true);
    });

    it("detects application/zip MIME type", () => {
      expect(isZipFile(makeFile("archive", "application/zip"))).toBe(true);
    });

    it("detects application/x-zip-compressed MIME type", () => {
      expect(
        isZipFile(makeFile("archive", "application/x-zip-compressed"))
      ).toBe(true);
    });

    it("returns false for audio files", () => {
      expect(isZipFile(makeFile("song.wav", "audio/wav"))).toBe(false);
    });

    it("returns false for random files", () => {
      expect(isZipFile(makeFile("readme.txt", "text/plain"))).toBe(false);
    });
  });

  describe("generateWaveformPeaks", () => {
    it("returns an array of the requested number of points", () => {
      const buffer = createMockAudioBuffer(2, 44100);
      const peaks = generateWaveformPeaks(buffer, 500);
      expect(peaks).toHaveLength(500);
    });

    it("returns values between 0 and 1", () => {
      const buffer = createMockAudioBuffer(2, 44100);
      const peaks = generateWaveformPeaks(buffer, 100);
      for (const v of peaks) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    });

    it("returns non-zero peaks for non-silent audio", () => {
      const buffer = createMockAudioBuffer(2, 44100);
      const peaks = generateWaveformPeaks(buffer, 100);
      expect(Math.max(...peaks)).toBeGreaterThan(0);
    });

    it("defaults to 500 points if count not specified", () => {
      const buffer = createMockAudioBuffer(1, 44100);
      const peaks = generateWaveformPeaks(buffer);
      expect(peaks).toHaveLength(500);
    });
  });

  describe("loadStemsFromFiles", () => {
    it("decodes multiple audio files", async () => {
      const ctx = createMockAudioContext();
      const files = [
        makeFile("vocals.wav", "audio/wav"),
        makeFile("drums.wav", "audio/wav"),
      ];

      const { stems } = await loadStemsFromFiles(files, ctx);

      expect(stems).toHaveLength(2);
      expect(stems[0].name).toBe("vocals.wav");
      expect(stems[1].name).toBe("drums.wav");
    });

    it("returns audioBuffer and waveformPeaks for each stem", async () => {
      const ctx = createMockAudioContext();
      const files = [makeFile("bass.wav", "audio/wav")];

      const { stems } = await loadStemsFromFiles(files, ctx);

      expect(stems[0].buffer).toBeDefined();
      expect(stems[0].waveformPeaks.length).toBeGreaterThan(0);
    });

    it("calls decodeAudioData for each valid file", async () => {
      const ctx = createMockAudioContext();
      const files = [
        makeFile("a.wav", "audio/wav"),
        makeFile("b.flac", "audio/flac"),
      ];

      await loadStemsFromFiles(files, ctx);

      expect(ctx.decodeAudioData).toHaveBeenCalledTimes(2);
    });

    it("skips files that fail to decode and reports failures", async () => {
      const ctx = createMockAudioContext();
      let callCount = 0;
      (ctx.decodeAudioData as ReturnType<typeof vi.fn>).mockImplementation(
        () => {
          callCount++;
          if (callCount === 2)
            return Promise.reject(new Error("Decode failed"));
          return Promise.resolve(createMockAudioBuffer());
        }
      );

      const files = [
        makeFile("good.wav", "audio/wav"),
        makeFile("corrupt.wav", "audio/wav"),
        makeFile("also-good.wav", "audio/wav"),
      ];

      const { stems, failures } = await loadStemsFromFiles(files, ctx);

      expect(stems).toHaveLength(2);
      expect(stems[0].name).toBe("good.wav");
      expect(stems[1].name).toBe("also-good.wav");
      expect(failures).toHaveLength(1);
      expect(failures[0].name).toBe("corrupt.wav");
    });

    it("skips non-audio files by extension", async () => {
      const ctx = createMockAudioContext();
      const files = [
        makeFile("vocals.wav", "audio/wav"),
        makeFile("readme.txt", "text/plain"),
        makeFile("photo.png", "image/png"),
      ];

      const { stems } = await loadStemsFromFiles(files, ctx);

      expect(stems).toHaveLength(1);
      expect(stems[0].name).toBe("vocals.wav");
    });

    it("returns empty stems for all-invalid files", async () => {
      const ctx = createMockAudioContext();
      const files = [makeFile("photo.png", "image/png")];

      const { stems } = await loadStemsFromFiles(files, ctx);

      expect(stems).toEqual([]);
    });

    it("returns failures when all files fail to decode", async () => {
      const ctx = createMockAudioContext();
      (ctx.decodeAudioData as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Decode failed")
      );

      const files = [makeFile("bad.wav", "audio/wav")];

      const { stems, failures } = await loadStemsFromFiles(files, ctx);

      expect(stems).toHaveLength(0);
      expect(failures).toHaveLength(1);
      expect(failures[0].name).toBe("bad.wav");
    });

    it("accepts all supported audio extensions", async () => {
      const ctx = createMockAudioContext();
      const files = [
        makeFile("a.wav", "audio/wav"),
        makeFile("b.mp3", "audio/mpeg"),
        makeFile("c.flac", "audio/flac"),
        makeFile("d.ogg", "audio/ogg"),
        makeFile("e.aac", "audio/aac"),
        makeFile("f.m4a", "audio/mp4"),
      ];

      const { stems } = await loadStemsFromFiles(files, ctx);

      expect(stems).toHaveLength(6);
    });
  });

  describe("loadStemsFromZip", () => {
    async function setupZipMock(
      entries: Array<{ path: string; dir: boolean }>
    ): Promise<void> {
      const JSZipMod = await import("jszip");
      const JSZip = JSZipMod.default;
      const mockZip = new JSZip();

      (mockZip.loadAsync as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockZip
      );
      (mockZip.forEach as ReturnType<typeof vi.fn>).mockImplementation(
        (
          cb: (
            path: string,
            entry: {
              dir: boolean;
              async: (type: string) => Promise<ArrayBuffer>;
            }
          ) => void
        ) => {
          for (const e of entries) {
            cb(e.path, {
              dir: e.dir,
              async: vi.fn().mockResolvedValue(new ArrayBuffer(100)),
            });
          }
        }
      );
    }

    it("extracts audio files from ZIP", async () => {
      await setupZipMock([
        { path: "vocals.wav", dir: false },
        { path: "drums.wav", dir: false },
      ]);

      const ctx = createMockAudioContext();
      const zipFile = makeFile("stems.zip", "application/zip");

      const { stems } = await loadStemsFromZip(zipFile, ctx);

      expect(stems).toHaveLength(2);
      expect(stems[0].name).toBe("vocals.wav");
      expect(stems[1].name).toBe("drums.wav");
    });

    it("ignores non-audio files in ZIP", async () => {
      await setupZipMock([
        { path: "vocals.wav", dir: false },
        { path: "readme.txt", dir: false },
        { path: "cover.jpg", dir: false },
      ]);

      const ctx = createMockAudioContext();
      const { stems } = await loadStemsFromZip(
        makeFile("stems.zip", "application/zip"),
        ctx
      );

      expect(stems).toHaveLength(1);
      expect(stems[0].name).toBe("vocals.wav");
    });

    it("ignores directories in ZIP", async () => {
      await setupZipMock([
        { path: "stems/", dir: true },
        { path: "stems/vocals.wav", dir: false },
      ]);

      const ctx = createMockAudioContext();
      const { stems } = await loadStemsFromZip(
        makeFile("stems.zip", "application/zip"),
        ctx
      );

      expect(stems).toHaveLength(1);
      expect(stems[0].name).toBe("vocals.wav");
    });

    it("strips directory paths from filenames", async () => {
      await setupZipMock([
        { path: "project/stems/sub/bass.mp3", dir: false },
      ]);

      const ctx = createMockAudioContext();
      const { stems } = await loadStemsFromZip(
        makeFile("stems.zip", "application/zip"),
        ctx
      );

      expect(stems[0].name).toBe("bass.mp3");
    });

    it("throws for ZIP with no audio files", async () => {
      await setupZipMock([
        { path: "readme.txt", dir: false },
        { path: "cover.jpg", dir: false },
      ]);

      const ctx = createMockAudioContext();

      await expect(
        loadStemsFromZip(makeFile("stems.zip", "application/zip"), ctx)
      ).rejects.toThrow("No audio files found in ZIP");
    });

    it("handles all supported audio formats in ZIP", async () => {
      await setupZipMock([
        { path: "a.wav", dir: false },
        { path: "b.mp3", dir: false },
        { path: "c.flac", dir: false },
        { path: "d.ogg", dir: false },
        { path: "e.aac", dir: false },
        { path: "f.m4a", dir: false },
      ]);

      const ctx = createMockAudioContext();
      const { stems } = await loadStemsFromZip(
        makeFile("all-formats.zip", "application/zip"),
        ctx
      );

      expect(stems).toHaveLength(6);
    });
  });
});
