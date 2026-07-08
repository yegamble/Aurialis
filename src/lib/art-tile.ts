/**
 * Deterministic gradient "album art" derived from a seed string (typically an
 * entry id). Ported from the design prototype's ArtTile idea: a hue pair hashed
 * from a string so every track gets a stable, distinct tile without any real
 * artwork existing.
 */
export interface ArtGradient {
  /** Top-left gradient stop. */
  a: string;
  /** Bottom-right gradient stop. */
  b: string;
  /** Accent used for the wave glyph. */
  accent: string;
}

function hashString(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function artGradient(seed: string): ArtGradient {
  const h = hashString(seed);
  const hue = h % 360;
  const hue2 = (hue + 35 + (h % 25)) % 360;
  return {
    a: `hsl(${hue} 52% 30%)`,
    b: `hsl(${hue2} 58% 11%)`,
    accent: `hsl(${hue} 82% 66%)`,
  };
}
