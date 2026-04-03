import {
  Music,
  Star,
  Zap,
  Guitar,
  Radio,
  Disc3,
  Headphones,
  Waves,
  Mic,
  Sparkles,
  Sun,
  Maximize2,
  Volume2,
  type LucideIcon,
} from "lucide-react";
import type { GenreName } from "./presets";
import type { ToggleName } from "@/types/mastering";

interface GenreOption {
  id: GenreName;
  label: string;
  icon: LucideIcon;
}

interface ToggleOption {
  id: ToggleName;
  label: string;
  icon: LucideIcon;
}

/** All genre options — every GenreName must have an entry. */
export const GENRE_OPTIONS: GenreOption[] = [
  { id: "hiphop", label: "Hip-Hop", icon: Music },
  { id: "pop", label: "Pop", icon: Star },
  { id: "rock", label: "Rock", icon: Zap },
  { id: "electronic", label: "Electronic", icon: Guitar },
  { id: "jazz", label: "Jazz", icon: Disc3 },
  { id: "classical", label: "Classical", icon: Headphones },
  { id: "rnb", label: "R&B", icon: Radio },
  { id: "lofi", label: "Lo-Fi", icon: Waves },
  { id: "podcast", label: "Podcast", icon: Mic },
];

/** Quick toggle options shown in SimpleMastering (5 of 7 toggles). */
export const QUICK_TOGGLE_OPTIONS: ToggleOption[] = [
  { id: "cleanup", label: "Clean Up", icon: Sparkles },
  { id: "warm", label: "Warm", icon: Sun },
  { id: "bright", label: "Bright", icon: Radio },
  { id: "wide", label: "Wide", icon: Maximize2 },
  { id: "loud", label: "Loud", icon: Volume2 },
];

/** Dynamics toggle options shown in AdvancedMastering (2 of 7 toggles). */
export const DYNAMICS_TOGGLE_OPTIONS: { id: ToggleName; label: string }[] = [
  { id: "deharsh", label: "De-Harsh" },
  { id: "glueComp", label: "Glue Comp" },
];
