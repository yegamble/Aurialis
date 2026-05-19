import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { LibraryView } from "../LibraryView";
import type { LibraryEntry } from "@/lib/storage/library-types";

function makeEntry(over: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    fingerprint: over.fingerprint ?? "fp-1",
    sha256: null,
    fileName: over.fileName ?? "song.wav",
    fileSize: 1024,
    lastModified: Date.now(),
    mimeType: "audio/wav",
    durationSec: over.durationSec ?? 218,
    createdAt: Date.now(),
    lastOpenedAt: Date.now(),
    audioPersisted: true,
    script: over.script ?? null,
    settings: null,
    ...over,
  };
}

describe("LibraryView", () => {
  const analyzedEntry = makeEntry({
    fingerprint: "fp-a",
    fileName: "Velvet Static.wav",
    durationSec: 218,
    // analyzed = has script
    script: { version: 1 } as never,
  });
  const draftEntry = makeEntry({
    fingerprint: "fp-d",
    fileName: "Backyard Bloom.wav",
    durationSec: 201,
    script: null,
  });

  it("renders the 'Your tracks' heading and library eyebrow", () => {
    render(
      <LibraryView
        entries={[analyzedEntry, draftEntry]}
        onOpenEntry={vi.fn()}
        onRequestDelete={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: /Your tracks/i })).toBeInTheDocument();
    expect(screen.getByText(/^Library$/i)).toBeInTheDocument();
  });

  it("shows the song count summary", () => {
    render(
      <LibraryView
        entries={[analyzedEntry, draftEntry]}
        onOpenEntry={vi.fn()}
        onRequestDelete={vi.fn()}
      />,
    );
    expect(screen.getByTestId("library-summary")).toHaveTextContent(/2 songs/i);
  });

  it("renders a row for every entry in the default (all) filter", () => {
    render(
      <LibraryView
        entries={[analyzedEntry, draftEntry]}
        onOpenEntry={vi.fn()}
        onRequestDelete={vi.fn()}
      />,
    );
    expect(screen.getAllByTestId("library-row")).toHaveLength(2);
  });

  it("filters to analyzed entries when 'Analyzed' is selected", () => {
    render(
      <LibraryView
        entries={[analyzedEntry, draftEntry]}
        onOpenEntry={vi.fn()}
        onRequestDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /Analyzed/i }));
    const rows = screen.getAllByTestId("library-row");
    expect(rows).toHaveLength(1);
    expect(within(rows[0]!).getByText(/Velvet Static\.wav/)).toBeInTheDocument();
  });

  it("filters to drafts when 'Drafts' is selected", () => {
    render(
      <LibraryView
        entries={[analyzedEntry, draftEntry]}
        onOpenEntry={vi.fn()}
        onRequestDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /Drafts/i }));
    const rows = screen.getAllByTestId("library-row");
    expect(rows).toHaveLength(1);
    expect(within(rows[0]!).getByText(/Backyard Bloom\.wav/)).toBeInTheDocument();
  });

  it("renders the album hero card when an album prop is supplied", () => {
    render(
      <LibraryView
        entries={[analyzedEntry]}
        onOpenEntry={vi.fn()}
        onRequestDelete={vi.fn()}
        album={{ title: "Nightline EP", artist: "Aurora Lane", trackCount: 6, avgLufs: -10.6 }}
        onOpenAlbum={vi.fn()}
      />,
    );
    expect(screen.getByTestId("album-hero-card")).toBeInTheDocument();
  });

  it("does NOT render the album hero card when no album is supplied", () => {
    render(
      <LibraryView
        entries={[analyzedEntry]}
        onOpenEntry={vi.fn()}
        onRequestDelete={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("album-hero-card")).not.toBeInTheDocument();
  });

  it("calls onUpload when the Import button is clicked", () => {
    const onUpload = vi.fn();
    render(
      <LibraryView
        entries={[analyzedEntry]}
        onOpenEntry={vi.fn()}
        onRequestDelete={vi.fn()}
        onUpload={onUpload}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Import$/i }));
    expect(onUpload).toHaveBeenCalledOnce();
  });

  it("calls onOpenEntry with the fingerprint when a row is clicked", () => {
    const onOpenEntry = vi.fn();
    render(
      <LibraryView
        entries={[analyzedEntry]}
        onOpenEntry={onOpenEntry}
        onRequestDelete={vi.fn()}
      />,
    );
    const row = screen.getByTestId("library-row");
    fireEvent.click(within(row).getByRole("button", { name: /^Velvet Static\.wav/ }));
    expect(onOpenEntry).toHaveBeenCalledWith("fp-a");
  });
});
