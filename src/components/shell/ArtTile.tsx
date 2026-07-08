import type { ReactElement } from "react";
import { artGradient } from "@/lib/art-tile";

export interface ArtTileProps {
  /** Seed string (typically an entry id) for the deterministic gradient. */
  seed: string;
  /** Square edge length in pixels. */
  size?: number;
  /** Corner radius in pixels. */
  radius?: number;
  "data-testid"?: string;
}

/**
 * Deterministic gradient "album art" tile. No real artwork exists; the gradient
 * and wave glyph are hashed from the seed so each entry gets a stable look.
 */
export function ArtTile({
  seed,
  size = 22,
  radius = 4,
  "data-testid": testId,
}: ArtTileProps): ReactElement {
  const g = artGradient(seed);
  const gid = `art-wave-${seed}-${size}`;
  return (
    <span
      data-testid={testId}
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: `linear-gradient(135deg, ${g.a} 0%, ${g.b} 100%)`,
        position: "relative",
        overflow: "hidden",
        flexShrink: 0,
        display: "inline-block",
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        style={{ position: "absolute", inset: 0, opacity: 0.95 }}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={g.accent} stopOpacity="0.85" />
            <stop offset="1" stopColor={g.accent} stopOpacity="0.15" />
          </linearGradient>
        </defs>
        <path
          d="M0 34 Q 8 22 16 30 T 32 36 T 48 24 T 64 30"
          stroke={`url(#${gid})`}
          strokeWidth={1.5}
          fill="none"
        />
      </svg>
    </span>
  );
}
