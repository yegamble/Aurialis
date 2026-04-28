/**
 * Tests for library-fingerprint.ts — cheap and SHA-256 fingerprint helpers.
 */

import { describe, expect, it } from "vitest";

import {
  cheapFingerprint,
  contentFingerprint,
  composeFingerprint,
} from "../library-fingerprint";

function fileWith(name: string, size: number, lastModified: number, bytes?: Uint8Array): File {
  const data = bytes ?? new Uint8Array(size);
  return new File([data], name, { type: "audio/wav", lastModified });
}

describe("library-fingerprint", () => {
  describe("cheapFingerprint", () => {
    it("is deterministic for the same name|size|lastModified", () => {
      const a = fileWith("song.wav", 1024, 1700000000000);
      const b = fileWith("song.wav", 1024, 1700000000000);
      expect(cheapFingerprint(a)).toBe(cheapFingerprint(b));
    });

    it("differs when name differs", () => {
      const a = fileWith("a.wav", 1024, 1700000000000);
      const b = fileWith("b.wav", 1024, 1700000000000);
      expect(cheapFingerprint(a)).not.toBe(cheapFingerprint(b));
    });

    it("differs when size differs", () => {
      const a = fileWith("song.wav", 1024, 1700000000000);
      const b = fileWith("song.wav", 2048, 1700000000000);
      expect(cheapFingerprint(a)).not.toBe(cheapFingerprint(b));
    });

    it("differs when lastModified differs", () => {
      const a = fileWith("song.wav", 1024, 1700000000000);
      const b = fileWith("song.wav", 1024, 1800000000000);
      expect(cheapFingerprint(a)).not.toBe(cheapFingerprint(b));
    });

    it("uses pipe delimiter", () => {
      const f = fileWith("song.wav", 1024, 1700000000000);
      expect(cheapFingerprint(f)).toBe("song.wav|1024|1700000000000");
    });

    it("handles empty filename", () => {
      const f = fileWith("", 0, 0);
      expect(cheapFingerprint(f)).toBe("|0|0");
    });
  });

  describe("contentFingerprint", () => {
    it("produces SHA-256 hex of the file bytes", async () => {
      // SHA-256 of empty file: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
      const empty = new File([new Uint8Array(0)], "e.wav");
      const fp = await contentFingerprint(empty);
      expect(fp).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    });

    it("differs for different content even when size matches", async () => {
      const a = new File([new Uint8Array([1, 2, 3, 4, 5])], "a.wav");
      const b = new File([new Uint8Array([5, 4, 3, 2, 1])], "b.wav");
      expect(await contentFingerprint(a)).not.toBe(await contentFingerprint(b));
    });

    it("is deterministic for identical bytes", async () => {
      const bytes = new Uint8Array([10, 20, 30, 40]);
      const a = new File([bytes], "x.wav");
      const b = new File([bytes], "y.wav"); // name shouldn't affect content hash
      expect(await contentFingerprint(a)).toBe(await contentFingerprint(b));
    });

    it("returns lowercase hex of length 64", async () => {
      const f = new File([new Uint8Array([1, 2, 3])], "f.wav");
      const fp = await contentFingerprint(f);
      expect(fp).toHaveLength(64);
      expect(fp).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("composeFingerprint", () => {
    it("appends a 16-char sha256 prefix to the cheap fingerprint", () => {
      const cheap = "song.wav|1024|1700000000000";
      const sha = "abcdef1234567890fedcba0987654321abcdef1234567890fedcba0987654321";
      expect(composeFingerprint(cheap, sha)).toBe(`${cheap}|abcdef1234567890`);
    });

    it("is deterministic", () => {
      const cheap = "x|1|1";
      const sha = "0123456789abcdef".repeat(4);
      expect(composeFingerprint(cheap, sha)).toBe(composeFingerprint(cheap, sha));
    });

    it("two distinct files with same cheap but different sha produce distinct composed fingerprints", () => {
      const cheap = "shared|1024|1700000000000";
      const sha1 = "aaaaaaaaaaaaaaaa" + "0".repeat(48);
      const sha2 = "bbbbbbbbbbbbbbbb" + "0".repeat(48);
      expect(composeFingerprint(cheap, sha1)).not.toBe(composeFingerprint(cheap, sha2));
    });
  });
});
