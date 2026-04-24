import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useIsLgViewport } from "@/hooks/use-is-lg-viewport";

type MqlListener = (e: MediaQueryListEvent) => void;

interface MockMql {
  matches: boolean;
  media: string;
  addEventListener: (type: "change", listener: MqlListener) => void;
  removeEventListener: (type: "change", listener: MqlListener) => void;
  dispatch: (matches: boolean) => void;
}

function installMatchMedia(initialMatches: boolean): MockMql {
  const listeners = new Set<MqlListener>();
  const mql: MockMql = {
    matches: initialMatches,
    media: "(min-width: 1024px)",
    addEventListener: (type, listener) => {
      if (type === "change") listeners.add(listener);
    },
    removeEventListener: (type, listener) => {
      if (type === "change") listeners.delete(listener);
    },
    dispatch(matches) {
      this.matches = matches;
      const event = { matches, media: this.media } as MediaQueryListEvent;
      for (const l of listeners) l(event);
    },
  };
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn(() => mql as unknown as MediaQueryList),
  });
  return mql;
}

describe("useIsLgViewport", () => {
  let originalMatchMedia: typeof window.matchMedia | undefined;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
  });

  afterEach(() => {
    if (originalMatchMedia) {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: originalMatchMedia,
      });
    }
  });

  it("returns true when viewport matches (min-width: 1024px) on mount", () => {
    installMatchMedia(true);
    const { result } = renderHook(() => useIsLgViewport());
    expect(result.current).toBe(true);
  });

  it("returns false when viewport does not match (min-width: 1024px) on mount", () => {
    installMatchMedia(false);
    const { result } = renderHook(() => useIsLgViewport());
    expect(result.current).toBe(false);
  });

  it("updates when the media query changes after mount", () => {
    const mql = installMatchMedia(true);
    const { result } = renderHook(() => useIsLgViewport());
    expect(result.current).toBe(true);

    act(() => mql.dispatch(false));
    expect(result.current).toBe(false);

    act(() => mql.dispatch(true));
    expect(result.current).toBe(true);
  });

  it("unsubscribes the listener on unmount", () => {
    const mql = installMatchMedia(true);
    const { unmount } = renderHook(() => useIsLgViewport());
    const removeSpy = vi.spyOn(mql, "removeEventListener");
    unmount();
    expect(removeSpy).toHaveBeenCalledWith("change", expect.any(Function));
  });
});
