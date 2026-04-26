"use client";

/**
 * EngineerProfilePicker — 5 engineer-style profile cards.
 *
 * Picking a card stages a selection in local state; clicking Apply commits
 * it to the deep store (which T17 wires up to trigger script regeneration).
 * If any move in the current script has been edited, T17 wraps the Apply
 * action in a confirmation dialog — that lives in the parent component.
 */

import { useState } from "react";
import { useDeepStore } from "@/lib/stores/deep-store";
import { PROFILE_IDS, type ProfileId } from "@/types/deep-mastering";

export interface ProfileCardInfo {
  id: ProfileId;
  name: string;
  description: string;
  accentColor: string;
}

/**
 * Display metadata for the 5 hand-tuned profiles. Mirrors the labels in
 * `backend/profiles/*.json`. Kept in sync via the script generator's
 * regeneration loop in T17.
 */
export const PROFILE_CARDS: readonly ProfileCardInfo[] = [
  {
    id: "modern_pop_polish",
    name: "Modern Pop Polish",
    description: "Tight low-end, airy top, controlled chorus loudness lift.",
    accentColor: "#0a84ff",
  },
  {
    id: "hip_hop_low_end",
    name: "Hip-Hop Low-End",
    description: "Sub-forward, punchy transients, wide chorus stereo image.",
    accentColor: "#9747ff",
  },
  {
    id: "indie_warmth",
    name: "Indie Warmth",
    description: "Warm mids, gentle compression, organic tonal balance.",
    accentColor: "#ff7a00",
  },
  {
    id: "metal_wall",
    name: "Metal Wall",
    description: "Aggressive midrange, tight bass, max chorus impact.",
    accentColor: "#ff3b30",
  },
  {
    id: "pop_punk_air",
    name: "Pop Punk Air",
    description: "Bright top, energetic drums, lifted vocal presence.",
    accentColor: "#34c759",
  },
] as const;

export interface EngineerProfilePickerProps {
  /** Called with the staged profile when the user clicks Apply. */
  onApply?: (profile: ProfileId) => void;
}

export function EngineerProfilePicker({
  onApply,
}: EngineerProfilePickerProps): React.ReactElement {
  const currentProfile = useDeepStore((s) => s.profile);
  const [staged, setStaged] = useState<ProfileId | null>(null);

  const selected = staged ?? currentProfile;
  const dirty = staged !== null && staged !== currentProfile;

  return (
    <div data-testid="engineer-profile-picker" className="flex flex-col gap-2">
      <h3 className="text-xs uppercase tracking-wider text-[rgba(255,255,255,0.5)]">
        Engineer Profile
      </h3>
      <div className="grid grid-cols-1 gap-2">
        {PROFILE_CARDS.map((card) => {
          const isSelected = card.id === selected;
          return (
            <button
              key={card.id}
              type="button"
              data-testid={`profile-card-${card.id}`}
              aria-pressed={isSelected}
              onClick={() => setStaged(card.id)}
              className={`text-left rounded-md p-3 transition-all border ${
                isSelected
                  ? "border-[rgba(255,255,255,0.3)] bg-[rgba(255,255,255,0.05)]"
                  : "border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.04)]"
              }`}
              style={
                isSelected
                  ? { boxShadow: `inset 4px 0 0 ${card.accentColor}` }
                  : undefined
              }
            >
              <div className="text-sm text-white">{card.name}</div>
              <div className="text-[11px] text-[rgba(255,255,255,0.55)]">
                {card.description}
              </div>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        data-testid="profile-apply-button"
        disabled={!dirty}
        onClick={() => {
          if (!dirty || !staged) return;
          onApply?.(staged);
        }}
        className={`mt-1 rounded-md px-4 py-1.5 text-xs transition-colors ${
          dirty
            ? "bg-[#0a84ff] text-white hover:bg-[#0066cc]"
            : "bg-[rgba(255,255,255,0.08)] text-[rgba(255,255,255,0.4)] cursor-not-allowed"
        }`}
      >
        Apply
      </button>
    </div>
  );
}

const _profileIdGuard: (id: ProfileId) => boolean = (id) =>
  PROFILE_IDS.includes(id);
void _profileIdGuard;
