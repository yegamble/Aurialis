import { describe, it, expect } from "vitest";
import { validateFile, AudioLoadError } from "../loader";

describe("validateFile", () => {
  it("accepts valid WAV file", () => {
    const file = new File(["data"], "test.wav", { type: "audio/wav" });
    expect(validateFile(file)).toEqual({ valid: true, warning: undefined });
  });

  it("accepts valid MP3 file", () => {
    const file = new File(["data"], "test.mp3", { type: "audio/mpeg" });
    expect(validateFile(file)).toEqual({ valid: true, warning: undefined });
  });

  it("accepts file by extension even with empty mime type", () => {
    const file = new File(["data"], "test.flac", { type: "" });
    expect(validateFile(file)).toEqual({ valid: true, warning: undefined });
  });

  it("rejects unsupported format", () => {
    const file = new File(["data"], "test.txt", { type: "text/plain" });
    expect(() => validateFile(file)).toThrow(AudioLoadError);
    expect(() => validateFile(file)).toThrow("Unsupported format");
  });

  it("rejects files over 200MB", () => {
    const size = 201 * 1024 * 1024;
    const file = new File(["x"], "huge.wav", { type: "audio/wav" });
    Object.defineProperty(file, "size", { value: size });
    expect(() => validateFile(file)).toThrow("File too large");
  });

  it("warns for files over 50MB", () => {
    const size = 60 * 1024 * 1024;
    const file = new File(["x"], "big.wav", { type: "audio/wav" });
    Object.defineProperty(file, "size", { value: size });
    const result = validateFile(file);
    expect(result.valid).toBe(true);
    expect(result.warning).toContain("Large file");
  });

  it("no warning for files under 50MB", () => {
    const file = new File(["x"], "small.wav", { type: "audio/wav" });
    Object.defineProperty(file, "size", { value: 10 * 1024 * 1024 });
    const result = validateFile(file);
    expect(result.warning).toBeUndefined();
  });

  it("AudioLoadError has correct code for unsupported format", () => {
    const file = new File(["data"], "test.xyz", { type: "video/mp4" });
    try {
      validateFile(file);
    } catch (e) {
      expect(e).toBeInstanceOf(AudioLoadError);
      expect((e as AudioLoadError).code).toBe("UNSUPPORTED_FORMAT");
    }
  });

  it("AudioLoadError has correct code for file too large", () => {
    const file = new File(["x"], "huge.wav", { type: "audio/wav" });
    Object.defineProperty(file, "size", { value: 300 * 1024 * 1024 });
    try {
      validateFile(file);
    } catch (e) {
      expect(e).toBeInstanceOf(AudioLoadError);
      expect((e as AudioLoadError).code).toBe("FILE_TOO_LARGE");
    }
  });
});
