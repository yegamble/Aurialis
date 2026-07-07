import { describe, it, expect, vi, beforeEach } from "vitest";
import { exportWav } from "../export";
import { DEFAULT_PARAMS } from "../presets";
import * as renderer from "../renderer";
import * as encoder from "../wav-encoder";

function mockBuffer(numSamples = 100, sampleRate = 44100): AudioBuffer {
  return {
    numberOfChannels: 2,
    length: numSamples,
    sampleRate,
    duration: numSamples / sampleRate,
    getChannelData: () => new Float32Array(numSamples),
    copyFromChannel: () => {},
    copyToChannel: () => {},
  } as unknown as AudioBuffer;
}

function mockAnchorDownload() {
  const anchor = { href: "", download: "", style: { display: "" }, click: vi.fn() };
  vi.spyOn(document, "createElement").mockReturnValue(anchor as unknown as HTMLElement);
  vi.spyOn(document.body, "appendChild").mockReturnValue(anchor as unknown as Node);
  vi.spyOn(document.body, "removeChild").mockReturnValue(anchor as unknown as Node);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  return anchor;
}

describe("exportWav", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calls renderOffline with source buffer and params", async () => {
    const renderSpy = vi
      .spyOn(renderer, "renderOffline")
      .mockResolvedValue(mockBuffer());
    vi.spyOn(encoder, "encodeWav").mockReturnValue(new ArrayBuffer(8));
    mockAnchorDownload();

    const src = mockBuffer();
    await exportWav(src, DEFAULT_PARAMS, { sampleRate: 44100, bitDepth: 16 });

    expect(renderSpy).toHaveBeenCalledWith(src, DEFAULT_PARAMS, 44100, null);
  });

  it("calls encodeWav with the rendered buffer and bitDepth", async () => {
    const rendered = mockBuffer();
    vi.spyOn(renderer, "renderOffline").mockResolvedValue(rendered);
    const encodeSpy = vi
      .spyOn(encoder, "encodeWav")
      .mockReturnValue(new ArrayBuffer(8));
    mockAnchorDownload();

    await exportWav(mockBuffer(), DEFAULT_PARAMS, { sampleRate: 44100, bitDepth: 24 });

    expect(encodeSpy).toHaveBeenCalledWith(rendered, 24, undefined);
  });

  it("triggers a download via anchor click with .wav extension", async () => {
    vi.spyOn(renderer, "renderOffline").mockResolvedValue(mockBuffer());
    vi.spyOn(encoder, "encodeWav").mockReturnValue(new ArrayBuffer(8));
    const anchor = mockAnchorDownload();

    await exportWav(mockBuffer(), DEFAULT_PARAMS, {
      sampleRate: 44100,
      bitDepth: 16,
      filename: "test-master",
    });

    expect(anchor.download).toBe("test-master.wav");
    expect(anchor.click).toHaveBeenCalled();
  });

  it("uses 'mastered' as default filename", async () => {
    vi.spyOn(renderer, "renderOffline").mockResolvedValue(mockBuffer());
    vi.spyOn(encoder, "encodeWav").mockReturnValue(new ArrayBuffer(8));
    const anchor = mockAnchorDownload();

    await exportWav(mockBuffer(), DEFAULT_PARAMS, { sampleRate: 44100, bitDepth: 16 });

    expect(anchor.download).toBe("mastered.wav");
  });

  it("routes format:'mp3' through the mp3 encoder and downloads a .mp3", async () => {
    const rendered = mockBuffer();
    vi.spyOn(renderer, "renderOffline").mockResolvedValue(rendered);
    const encodeWavSpy = vi.spyOn(encoder, "encodeWav");
    const mp3 = await import("../mp3-encoder");
    const mp3Spy = vi
      .spyOn(mp3, "encodeMp3")
      .mockResolvedValue(new ArrayBuffer(16));
    const anchor = mockAnchorDownload();

    await exportWav(mockBuffer(), DEFAULT_PARAMS, {
      sampleRate: 44100,
      bitDepth: 16,
      format: "mp3",
      mp3Bitrate: 256,
    });

    expect(mp3Spy).toHaveBeenCalledWith(rendered, 256);
    expect(encodeWavSpy).not.toHaveBeenCalled();
    expect(anchor.download).toBe("mastered.mp3");
  });

  it("defaults MP3 bitrate to 320 when unspecified", async () => {
    vi.spyOn(renderer, "renderOffline").mockResolvedValue(mockBuffer());
    const mp3 = await import("../mp3-encoder");
    const mp3Spy = vi
      .spyOn(mp3, "encodeMp3")
      .mockResolvedValue(new ArrayBuffer(16));
    mockAnchorDownload();

    await exportWav(mockBuffer(), DEFAULT_PARAMS, {
      sampleRate: 44100,
      bitDepth: 16,
      format: "mp3",
    });

    expect(mp3Spy).toHaveBeenCalledWith(expect.anything(), 320);
  });
});
