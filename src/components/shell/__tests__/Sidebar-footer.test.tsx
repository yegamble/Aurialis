import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Sidebar } from "../Sidebar";

const checkBackendHealth = vi.fn();
vi.mock("@/lib/api/separation", () => ({
  checkBackendHealth: () => checkBackendHealth(),
}));

describe("Sidebar — footer status block", () => {
  beforeEach(() => {
    checkBackendHealth.mockReset();
    checkBackendHealth.mockResolvedValue({ ok: true, gpu: false, models: [] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the storage usage from navigator.storage.estimate", async () => {
    vi.stubGlobal("navigator", {
      storage: {
        estimate: async () => ({ usage: 128 * 1024 * 1024, quota: 1e9 }),
      },
    });
    render(<Sidebar activeScreen="library" onSelect={vi.fn()} />);
    const cache = await screen.findByTestId("sidebar-cache-size");
    await waitFor(() => expect(cache).toHaveTextContent("128 MB"));
  });

  it("shows backend online (green) when health check succeeds", async () => {
    checkBackendHealth.mockResolvedValue({ ok: true, gpu: false, models: [] });
    render(<Sidebar activeScreen="library" onSelect={vi.fn()} />);
    const status = await screen.findByTestId("sidebar-backend-status");
    await waitFor(() => expect(status).toHaveTextContent(/online/i));
  });

  it("shows backend offline (red) when health check fails", async () => {
    checkBackendHealth.mockResolvedValue({ ok: false, gpu: false, models: [] });
    render(<Sidebar activeScreen="library" onSelect={vi.fn()} />);
    const status = await screen.findByTestId("sidebar-backend-status");
    await waitFor(() => expect(status).toHaveTextContent(/offline/i));
  });

  it("checks backend health exactly once on mount (no polling)", async () => {
    render(<Sidebar activeScreen="library" onSelect={vi.fn()} />);
    await screen.findByTestId("sidebar-backend-status");
    await new Promise((r) => setTimeout(r, 50));
    expect(checkBackendHealth).toHaveBeenCalledTimes(1);
  });

  it("keeps the Pro Mode toggle intact alongside the status block", () => {
    render(
      <Sidebar
        activeScreen="library"
        onSelect={vi.fn()}
        proMode={false}
        onProModeChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("pro-mode-toggle")).toBeInTheDocument();
  });
});
