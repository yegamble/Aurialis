import { describe, it, expect, afterEach, vi } from "vitest";
import { formatBytes, getStorageUsage } from "../storage-estimate";

describe("formatBytes", () => {
  it("formats sub-KB values in bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
  });

  it("formats KB/MB/GB with one decimal under 10", () => {
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(128 * 1024 * 1024)).toBe("128 MB");
    expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe("2.5 GB");
  });

  it("returns an em dash for invalid input", () => {
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(NaN)).toBe("—");
  });
});

describe("getStorageUsage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null when the Storage API is unavailable", async () => {
    vi.stubGlobal("navigator", {});
    expect(await getStorageUsage()).toBeNull();
  });

  it("returns the usage bytes when estimate resolves", async () => {
    vi.stubGlobal("navigator", {
      storage: { estimate: async () => ({ usage: 4096, quota: 1e9 }) },
    });
    expect(await getStorageUsage()).toBe(4096);
  });

  it("returns null gracefully when estimate throws", async () => {
    vi.stubGlobal("navigator", {
      storage: {
        estimate: async () => {
          throw new Error("nope");
        },
      },
    });
    expect(await getStorageUsage()).toBeNull();
  });
});
