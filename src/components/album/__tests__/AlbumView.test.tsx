import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { AlbumView, type AlbumTrackRow } from "../AlbumView";

const baseProps = {
  title: "Nightline EP",
  artist: "Aurora Lane",
  targetLufs: -10,
  tracks: [
    { id: "fp-1", title: "Velvet Static", lufs: -8.7, durationSec: 218 },
    { id: "fp-2", title: "Slow Run", lufs: -9.4, durationSec: 184 },
    { id: "fp-3", title: "Honey Walls", lufs: -11.2, durationSec: 245 },
    { id: "fp-4", title: "Backyard Bloom", lufs: null, durationSec: 201 },
  ] as AlbumTrackRow[],
  onOpenTrack: vi.fn(),
};

describe("AlbumView", () => {
  it("renders the Smart Master Album eyebrow + title + artist + track count", () => {
    render(<AlbumView {...baseProps} />);
    expect(screen.getByText(/Smart Master Album/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Nightline EP/i })).toBeInTheDocument();
    expect(screen.getByText(/Aurora Lane/)).toBeInTheDocument();
    expect(screen.getByText(/4 tracks/)).toBeInTheDocument();
  });

  it("renders 'Master entire album' button and fires onMasterAll when clicked", () => {
    const onMasterAll = vi.fn();
    render(<AlbumView {...baseProps} onMasterAll={onMasterAll} />);
    const btn = screen.getByRole("button", { name: /Master entire album/i });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onMasterAll).toHaveBeenCalledOnce();
  });

  it("disables 'Master entire album' when onMasterAll is not provided", () => {
    render(<AlbumView {...baseProps} />);
    expect(screen.getByRole("button", { name: /Master entire album/i })).toBeDisabled();
  });

  it("renders one row per track with title visible", () => {
    render(<AlbumView {...baseProps} />);
    const rows = screen.getAllByTestId("album-track-row");
    expect(rows).toHaveLength(4);
    expect(within(rows[0]!).getByText("Velvet Static")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Slow Run")).toBeInTheDocument();
  });

  it("formats LUFS value with one decimal and minus sign", () => {
    render(<AlbumView {...baseProps} />);
    const row = screen.getAllByTestId("album-track-row")[0]!;
    expect(within(row).getByTestId("album-track-lufs")).toHaveTextContent("−8.7");
  });

  it("shows em-dash placeholder when LUFS is null", () => {
    render(<AlbumView {...baseProps} />);
    const row = screen.getAllByTestId("album-track-row")[3]!;
    expect(within(row).getByTestId("album-track-lufs")).toHaveTextContent("—");
  });

  it("computes delta from target with signed value", () => {
    render(<AlbumView {...baseProps} />);
    // target -10, t1 lufs -8.7 → +1.3
    expect(
      within(screen.getAllByTestId("album-track-row")[0]!).getByTestId("album-track-delta"),
    ).toHaveTextContent("+1.3");
    // t3 lufs -11.2 → -1.2
    expect(
      within(screen.getAllByTestId("album-track-row")[2]!).getByTestId("album-track-delta"),
    ).toHaveTextContent("−1.2");
  });

  it("shows 'On target' when delta is within 0.5 LU", () => {
    const props = {
      ...baseProps,
      tracks: [{ id: "fp-x", title: "Even", lufs: -10.2, durationSec: 100 }],
    };
    render(<AlbumView {...props} />);
    expect(screen.getByText(/On target/i)).toBeInTheDocument();
  });

  it("calls onOpenTrack with track id when Open is clicked", () => {
    const onOpenTrack = vi.fn();
    render(<AlbumView {...baseProps} onOpenTrack={onOpenTrack} />);
    const row = screen.getAllByTestId("album-track-row")[0]!;
    fireEvent.click(within(row).getByRole("button", { name: /Open/i }));
    expect(onOpenTrack).toHaveBeenCalledWith("fp-1");
  });

  it("renders empty state when tracks is empty", () => {
    render(<AlbumView {...baseProps} tracks={[]} />);
    expect(screen.getByTestId("album-empty")).toBeInTheDocument();
    expect(screen.queryAllByTestId("album-track-row")).toHaveLength(0);
  });

  it("renders the target LUFS in the loudness summary", () => {
    render(<AlbumView {...baseProps} />);
    expect(screen.getByTestId("album-target-lufs")).toHaveTextContent("−10.0");
  });

  it("renders the hero stats column with target, range and issues", () => {
    render(<AlbumView {...baseProps} />);
    const stats = screen.getByTestId("album-hero-stats");
    // target
    expect(within(stats).getByText(/−10\.0 LUFS/)).toBeInTheDocument();
    // range = min → max of measured LUFS (−11.2 → −8.7)
    expect(within(stats).getByText(/−11\.2\s*→\s*−8\.7/)).toBeInTheDocument();
    // issues: none of the base tracks drift > 1.5 LU
    expect(within(stats).getByText(/^Issues$/)).toBeInTheDocument();
  });

  it("counts issues as tracks drifting more than 1.5 LU from target", () => {
    const props = {
      ...baseProps,
      targetLufs: -6,
      tracks: [
        { id: "a", title: "Loud", lufs: -8.7, durationSec: 100 },
        { id: "b", title: "Fine", lufs: -6.2, durationSec: 100 },
      ] as AlbumTrackRow[],
    };
    render(<AlbumView {...props} />);
    const stats = screen.getByTestId("album-hero-stats");
    // -8.7 vs -6 → 2.7 LU drift (issue); -6.2 vs -6 → 0.2 (ok) ⇒ 1 issue
    expect(within(stats).getByTestId("album-hero-issues")).toHaveTextContent("1");
  });

  it("shows an em-dash range when no track has a measured LUFS", () => {
    const props = {
      ...baseProps,
      tracks: [{ id: "n", title: "None", lufs: null, durationSec: 100 }] as AlbumTrackRow[],
    };
    render(<AlbumView {...props} />);
    expect(within(screen.getByTestId("album-hero-stats")).getByTestId("album-hero-range")).toHaveTextContent("—");
  });
});
