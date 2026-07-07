"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { motion } from "motion/react";
import type { DitherType } from "@/lib/audio/wav-encoder";
import type { ExportFormat } from "@/lib/audio/export";

export interface ExportSettings {
  format: ExportFormat;
  sampleRate: number;
  bitDepth: 16 | 24 | 32;
  dither?: DitherType;
}

interface ExportPanelProps {
  onExport?: (settings: ExportSettings) => Promise<void>;
  isExporting?: boolean;
}

const FORMATS: ReadonlyArray<{ value: ExportFormat; label: string }> = [
  { value: "wav", label: "WAV" },
  { value: "mp3", label: "MP3" },
];

const SAMPLE_RATES: ReadonlyArray<{ value: number; label: string }> = [
  { value: 44100, label: "44.1 kHz" },
  { value: 48000, label: "48 kHz" },
  { value: 96000, label: "96 kHz" },
  { value: 192000, label: "192 kHz" },
];

const BIT_DEPTHS: ReadonlyArray<{ value: 16 | 24 | 32; label: string }> = [
  { value: 16, label: "16-bit" },
  { value: 24, label: "24-bit" },
  { value: 32, label: "32-bit float" },
];

export function ExportPanel({ onExport, isExporting = false }: ExportPanelProps) {
  const [format, setFormat] = useState<ExportFormat>("wav");
  const [sampleRate, setSampleRate] = useState<number>(44100);
  const [bitDepth, setBitDepth] = useState<16 | 24 | 32>(16);
  const [dither, setDither] = useState(true);

  const lossy = format === "mp3";

  const handleExport = () => {
    if (!onExport || isExporting) return;
    onExport({
      format,
      sampleRate,
      bitDepth,
      dither: dither ? "tpdf" : "none",
    });
  };

  return (
    <div className="rounded-2xl bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] p-5 space-y-4">
      <p className="text-[rgba(255,255,255,0.6)] text-xs uppercase tracking-wider">
        Export
      </p>

      <Segmented
        label="Format"
        value={format}
        onChange={setFormat}
        options={FORMATS}
      />
      <Segmented
        label="Sample rate"
        value={sampleRate}
        onChange={setSampleRate}
        options={SAMPLE_RATES}
        size="sm"
      />
      <Segmented
        label="Bit depth"
        value={bitDepth}
        onChange={setBitDepth}
        options={BIT_DEPTHS}
        size="sm"
        disabled={lossy}
      />
      <Toggle
        label="Dither"
        active={dither}
        onChange={setDither}
        disabled={lossy}
      />

      <motion.button
        onClick={handleExport}
        disabled={isExporting || !onExport}
        whileHover={!isExporting ? { scale: 1.01 } : {}}
        whileTap={!isExporting ? { scale: 0.99 } : {}}
        className={`w-full py-3 rounded-xl bg-gradient-to-r from-[#30d158] to-[#34c759] text-white text-sm flex items-center justify-center gap-2 shadow-[0_2px_16px_rgba(48,209,88,0.25)] transition-opacity ${
          isExporting || !onExport ? "opacity-50 cursor-not-allowed" : ""
        }`}
      >
        <Download className="w-4 h-4" />
        {isExporting ? "Exporting…" : `Export ${format.toUpperCase()}`}
      </motion.button>
    </div>
  );
}

function Segmented<T extends string | number>({
  label,
  value,
  onChange,
  options,
  size = "md",
  disabled = false,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
  size?: "sm" | "md";
  disabled?: boolean;
}) {
  return (
    <div>
      <p className="text-[rgba(255,255,255,0.35)] text-[10px] uppercase tracking-wider mb-1">
        {label}
      </p>
      <div
        role="group"
        aria-label={label}
        className={`flex gap-1 bg-[rgba(255,255,255,0.04)] rounded-lg p-0.5 ${
          disabled ? "opacity-40" : ""
        }`}
      >
        {options.map((o) => {
          const selected = value === o.value;
          return (
            <button
              key={String(o.value)}
              type="button"
              disabled={disabled}
              onClick={() => onChange(o.value)}
              aria-pressed={selected}
              className={`flex-1 rounded-md transition-all ${
                size === "sm" ? "py-1 text-[11px]" : "py-1.5 text-xs"
              } ${
                selected
                  ? "bg-[rgba(255,255,255,0.1)] text-white"
                  : "text-[rgba(255,255,255,0.4)] hover:text-[rgba(255,255,255,0.6)]"
              } ${disabled ? "cursor-not-allowed" : ""}`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Toggle({
  label,
  active,
  onChange,
  disabled = false,
}: {
  label: string;
  active: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-[rgba(255,255,255,0.35)] text-[10px] uppercase tracking-wider">
        {label}
      </p>
      <button
        type="button"
        role="switch"
        aria-checked={active}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!active)}
        className={`relative h-5 w-9 rounded-full transition-colors ${
          active ? "bg-[#30d158]" : "bg-[rgba(255,255,255,0.15)]"
        } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
            active ? "translate-x-[18px]" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}
