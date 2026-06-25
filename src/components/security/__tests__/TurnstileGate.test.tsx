import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, renderHook } from "@testing-library/react";
import {
  TurnstileGate,
  useTurnstileToken,
  getTurnstileSiteKey,
} from "../TurnstileGate";

afterEach(() => {
  vi.unstubAllEnvs();
  delete window.turnstile;
});

describe("TurnstileGate — key-optional bypass", () => {
  it("renders nothing and reports no site key when unconfigured", () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    expect(getTurnstileSiteKey()).toBeNull();
    const { container } = render(<TurnstileGate onToken={() => {}} />);
    expect(
      container.querySelector('[data-testid="turnstile-gate"]'),
    ).toBeNull();
  });

  it("useTurnstileToken yields an empty token (legacy fallback) when unconfigured", () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    const { result } = renderHook(() => useTurnstileToken());
    expect(result.current.siteKey).toBeNull();
    expect(result.current.token).toBe("");
    expect(result.current.gate).toBeNull();
  });

  it("renders the widget and surfaces the token when configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "0xTESTKEY");
    const renderSpy = vi.fn();
    window.turnstile = {
      render: (_el, opts) => {
        renderSpy();
        opts.callback("tok-123");
        return "wid-1";
      },
      remove: () => {},
      reset: () => {},
    };
    const onToken = vi.fn();
    render(<TurnstileGate onToken={onToken} />);
    expect(screen.getByTestId("turnstile-gate")).toBeInTheDocument();
    await waitFor(() => expect(onToken).toHaveBeenCalledWith("tok-123"));
    expect(renderSpy).toHaveBeenCalled();
  });
});
