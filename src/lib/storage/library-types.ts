import type { MasteringScript } from "@/types/deep-mastering";
import type { AudioParams } from "@/types/mastering";
import type { GenreName } from "@/lib/audio/presets";
import type { TonePresetName, OutputPresetName } from "@/lib/audio/ui-presets";

export type ToggleName = "deharsh" | "glueComp";

export interface PersistedSettings {
  params: AudioParams;
  simple: {
    genre: GenreName;
    intensity: number;
    toggles: Record<ToggleName, boolean>;
  };
  tonePreset: TonePresetName | null;
  outputPreset: OutputPresetName | null;
  savedAt: number;
}

export interface LibraryEntry {
  /** Primary key — `cheap` or `cheap|sha256-prefix` after collision. */
  fingerprint: string;
  /** Hex SHA-256 of audio bytes. Lazily populated on first collision. */
  sha256: string | null;
  fileName: string;
  fileSize: number;
  lastModified: number;
  mimeType: string;
  durationSec: number | null;
  createdAt: number;
  lastOpenedAt: number;
  /** False when OPFS unavailable — entry has metadata + script + settings only. */
  audioPersisted: boolean;
  script: MasteringScript | null;
  settings: PersistedSettings | null;
}

export type AudioPersistenceMode = "full" | "metadata-only";
