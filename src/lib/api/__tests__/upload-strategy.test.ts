import { describe, it, expect } from "vitest";
import {
  resolveUploadStrategy,
  TurnstileRequiredError,
} from "../upload-strategy";

describe("resolveUploadStrategy", () => {
  it("uses R2 when the site key is configured and a token exists", () => {
    expect(resolveUploadStrategy("tok-1", true)).toEqual({
      kind: "r2",
      token: "tok-1",
    });
  });

  it("throws an actionable error when configured but no token is available", () => {
    expect(() => resolveUploadStrategy("", true)).toThrow(
      TurnstileRequiredError,
    );
    expect(() => resolveUploadStrategy(undefined, true)).toThrow(
      "Verification required — retry the security check",
    );
  });

  it("uses the dev-only multipart path when no site key is configured", () => {
    expect(resolveUploadStrategy(undefined, false)).toEqual({
      kind: "multipart",
    });
    // Even with a stray token: without a site key there is no Worker to
    // verify it — dev mode is multipart, period.
    expect(resolveUploadStrategy("tok-1", false)).toEqual({
      kind: "multipart",
    });
  });

  it("defaults the configured flag from the environment (unset in tests → multipart)", () => {
    expect(resolveUploadStrategy(undefined)).toEqual({ kind: "multipart" });
  });
});
