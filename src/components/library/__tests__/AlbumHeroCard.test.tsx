import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AlbumHeroCard } from "../AlbumHeroCard";

describe("AlbumHeroCard", () => {
  const baseProps = {
    title: "Nightline EP",
    artist: "Aurora Lane",
    trackCount: 6,
  };

  it("renders album title and artist", () => {
    render(<AlbumHeroCard {...baseProps} />);
    expect(screen.getByText("Nightline EP")).toBeInTheDocument();
    expect(screen.getByText("Aurora Lane")).toBeInTheDocument();
  });

  it("renders 'Album · N tracks' badge with the count", () => {
    render(<AlbumHeroCard {...baseProps} />);
    expect(screen.getByText(/Album · 6 tracks/i)).toBeInTheDocument();
  });

  it("formats avg LUFS to one decimal with explicit sign", () => {
    render(<AlbumHeroCard {...baseProps} avgLufs={-10.6} />);
    expect(screen.getByTestId("album-avg-lufs")).toHaveTextContent("−10.6");
  });

  it("shows em-dash placeholder when avg LUFS is undefined", () => {
    render(<AlbumHeroCard {...baseProps} />);
    expect(screen.getByTestId("album-avg-lufs")).toHaveTextContent("—");
  });

  it("fires onClick when the card is activated", () => {
    const onClick = vi.fn();
    render(<AlbumHeroCard {...baseProps} onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: /Nightline EP/i }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("exposes data-testid='album-hero-card'", () => {
    render(<AlbumHeroCard {...baseProps} />);
    expect(screen.getByTestId("album-hero-card")).toBeInTheDocument();
  });
});
