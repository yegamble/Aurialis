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

const FORMATS: ReadonlyArray<{ id: ExportFormat; label: string }> = [
  { id: "wav", label: "WAV" },
  { id: "mp3", label: "MP3" },
];

const SR_MAP: Record<string, number> = {
  "44.1 kHz": 44100,
  "48 kHz":   48000,
  "96 kHz":   96000,
};

const BD_MAP: Record<string, 16 | 24 | 32> = {
  "16-bit":       16,
  "24-bit":       24,
  "32-bit float": 32,
};

export function ExportPanel({ onExport, isExporting = false }: ExportPanelProps) {
  const [format, setFormat] = useState<ExportFormat>("wav");
  const [sampleRate, setSampleRate] = useState("44.1 kHz");
  const [bitDepth, setBitDepth] = useState("16-bit");
  const [dither, setDither] = useState("TPDF");

  const DITHER_MAP: Record<string, DitherType> = {
    "None": "none",
    "TPDF": "tpdf",
  };

  const handleExport = () => {
    if (!onExport || isExporting) return;
    const settings: ExportSettings = {
      format,
      sampleRate: SR_MAP[sampleRate] ?? 44100,
      bitDepth: BD_MAP[bitDepth] ?? 16,
      dither: DITHER_MAP[dither] ?? "tpdf",
    };
    onExport(settings);
  };

  return (
    <div className="rounded-2xl bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] p-5 space-y-4">
      <p className="text-[rgba(255,255,255,0.6)] text-xs uppercase tracking-wider">
        Export
      </p>

      <div>
        <p className="text-[rgba(255,255,255,0.35)] text-[10px] uppercase tracking-wider mb-1">
          Format
        </p>
        <div
          className="flex gap-1 bg-[rgba(255,255,255,0.04)] rounded-lg p-0.5"
          role="group"
          aria-label="Format"
        >
          {FORMATS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFormat(f.id)}
              aria-pressed={format === f.id}
              className={`flex-1 py-1.5 rounded-md text-xs transition-all ${
                format === f.id
                  ? "bg-[rgba(255,255,255,0.1)] text-white"
                  : "text-[rgba(255,255,255,0.4)] hover:text-[rgba(255,255,255,0.6)]"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <SelectField
          label="Sample Rate"
          value={sampleRate}
          onChange={setSampleRate}
          options={["44.1 kHz", "48 kHz", "96 kHz"]}
        />
        <SelectField
          label="Bit Depth"
          value={bitDepth}
          onChange={setBitDepth}
          options={["16-bit", "24-bit", "32-bit float"]}
          disabled={format === "mp3"}
        />
        <SelectField
          label="Dither"
          value={dither}
          onChange={setDither}
          options={["None", "TPDF"]}
          disabled={format === "mp3"}
        />
      </div>

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

function SelectField({
  label,
  value,
  onChange,
  options,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  disabled?: boolean;
}) {
  return (
    <div>
      <p className="text-[rgba(255,255,255,0.35)] text-[10px] uppercase tracking-wider mb-1">
        {label}
      </p>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.08)] rounded-lg px-2 py-1.5 text-white text-xs appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#0a84ff] disabled:cursor-not-allowed disabled:opacity-40"
        aria-label={label}
      >
        {options.map((o) => (
          <option key={o} value={o} className="bg-[#1c1c1e]">
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}
