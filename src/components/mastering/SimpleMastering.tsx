"use client";

import { useState, useRef } from "react";
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
  Wand2,
} from "lucide-react";
import { motion } from "motion/react";

interface SimpleMasteringProps {
  intensity: number;
  onIntensityChange: (val: number) => void;
  genre: string;
  onGenreChange: (genre: string) => void;
  toggles: Record<string, boolean>;
  onToggle: (key: string) => void;
  onAutoMaster: () => void;
}

const genres = [
  { id: "hiphop", label: "Hip-Hop", icon: Music },
  { id: "pop", label: "Pop", icon: Star },
  { id: "rock", label: "Rock", icon: Zap },
  { id: "electronic", label: "Electronic", icon: Guitar },
  { id: "jazz", label: "Jazz", icon: Disc3 },
  { id: "classical", label: "Classical", icon: Headphones },
  { id: "lofi", label: "Lo-Fi", icon: Waves },
  { id: "podcast", label: "Podcast", icon: Mic },
];

const quickToggles = [
  { id: "cleanup", label: "Clean Up", icon: Sparkles },
  { id: "warm", label: "Warm", icon: Sun },
  { id: "bright", label: "Bright", icon: Radio },
  { id: "wide", label: "Wide", icon: Maximize2 },
  { id: "loud", label: "Loud", icon: Volume2 },
];

export function SimpleMastering({
  intensity,
  onIntensityChange,
  genre,
  onGenreChange,
  toggles,
  onToggle,
  onAutoMaster,
}: SimpleMasteringProps) {
  const [isDragging, setIsDragging] = useState(false);
  const intensityRef = useRef(intensity);
  intensityRef.current = intensity;

  return (
    <div className="space-y-6 p-1">
      {/* Intensity Knob */}
      <div className="flex flex-col items-center gap-3">
        <div
          data-knob
          className="relative w-32 h-32 cursor-pointer select-none"
          role="slider"
          aria-label="Mastering intensity"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={intensity}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" || e.key === "ArrowRight")
              onIntensityChange(Math.min(100, intensity + 1));
            if (e.key === "ArrowDown" || e.key === "ArrowLeft")
              onIntensityChange(Math.max(0, intensity - 1));
          }}
          onMouseDown={() => {
            setIsDragging(true);
            let lastY: number | null = null;
            const handleMove = (ev: MouseEvent) => {
              if (lastY === null) {
                lastY = ev.clientY;
                return;
              }
              const diff = lastY - ev.clientY;
              lastY = ev.clientY;
              intensityRef.current = Math.round(
                Math.max(0, Math.min(100, intensityRef.current + diff * 0.5))
              );
              onIntensityChange(intensityRef.current);
            };
            const handleUp = () => {
              setIsDragging(false);
              window.removeEventListener("mousemove", handleMove);
              window.removeEventListener("mouseup", handleUp);
            };
            window.addEventListener("mousemove", handleMove);
            window.addEventListener("mouseup", handleUp);
          }}
        >
          {/* Track */}
          <svg className="w-full h-full" viewBox="0 0 100 100">
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke="rgba(255,255,255,0.06)"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={`${Math.PI * 84 * 0.75} ${Math.PI * 84 * 0.25}`}
              transform="rotate(135 50 50)"
            />
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke="url(#knobGrad)"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={`${(intensity / 100) * Math.PI * 84 * 0.75} ${Math.PI * 84}`}
              transform="rotate(135 50 50)"
            />
            <defs>
              <linearGradient id="knobGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#0a84ff" />
                <stop offset="100%" stopColor="#5ac8fa" />
              </linearGradient>
            </defs>
          </svg>

          {/* Center */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div
              className={`w-20 h-20 rounded-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] flex items-center justify-center transition-shadow ${
                isDragging ? "shadow-[0_0_24px_rgba(10,132,255,0.3)]" : ""
              }`}
            >
              <span className="text-[1.75rem] tracking-tight text-white tabular-nums">
                {intensity}
              </span>
            </div>
          </div>
        </div>
        <p className="text-[rgba(255,255,255,0.5)] text-xs uppercase tracking-wider">
          Intensity
        </p>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="px-5 py-2 rounded-full bg-gradient-to-r from-[#0a84ff] to-[#5ac8fa] text-white text-sm flex items-center gap-2 shadow-[0_2px_16px_rgba(10,132,255,0.3)]"
          onClick={onAutoMaster}
        >
          <Wand2 className="w-4 h-4" />
          Auto Master
        </motion.button>
      </div>

      {/* Genre */}
      <div>
        <p className="text-[rgba(255,255,255,0.5)] text-xs uppercase tracking-wider mb-3">
          Genre
        </p>
        <div className="grid grid-cols-4 gap-2">
          {genres.map((g) => (
            <button
              key={g.id}
              onClick={() => onGenreChange(g.id)}
              className={`flex flex-col items-center gap-1.5 py-2.5 px-1 rounded-xl transition-all text-xs
                ${
                  genre === g.id
                    ? "bg-[#0a84ff]/[0.15] border border-[#0a84ff]/30 text-[#0a84ff]"
                    : "bg-[rgba(255,255,255,0.04)] border border-transparent text-[rgba(255,255,255,0.5)] hover:bg-[rgba(255,255,255,0.06)]"
                }
              `}
              aria-pressed={genre === g.id}
            >
              <g.icon className="w-4 h-4" />
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {/* Quick Toggles */}
      <div>
        <p className="text-[rgba(255,255,255,0.5)] text-xs uppercase tracking-wider mb-3">
          Quick Toggles
        </p>
        <div className="flex flex-wrap gap-2">
          {quickToggles.map((t) => (
            <button
              key={t.id}
              onClick={() => onToggle(t.id)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl transition-all text-xs
                ${
                  toggles[t.id]
                    ? "bg-[#0a84ff]/[0.15] border border-[#0a84ff]/30 text-[#0a84ff]"
                    : "bg-[rgba(255,255,255,0.04)] border border-transparent text-[rgba(255,255,255,0.5)] hover:bg-[rgba(255,255,255,0.06)]"
                }
              `}
              aria-pressed={toggles[t.id]}
            >
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
