"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { StemChannelParams, StemClassification } from "@/types/mixer";

interface ChannelStripProps {
  stemId: string;
  name: string;
  color: string;
  classification: StemClassification;
  params: StemChannelParams;
  onParamChange: (stemId: string, key: keyof StemChannelParams, value: StemChannelParams[keyof StemChannelParams]) => void;
  onMuteToggle: (stemId: string) => void;
  onSoloToggle: (stemId: string) => void;
  isEffectivelyMuted: boolean;
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[rgba(255,255,255,0.4)] text-[10px] w-12 shrink-0 truncate">
        {label}
      </span>
      <div className="flex-1 relative h-6 flex items-center">
        <div className="w-full h-0.5 rounded-full bg-[rgba(255,255,255,0.08)]">
          <div
            className="h-full rounded-full bg-[#0a84ff]"
            style={{ width: `${pct}%` }}
          />
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          aria-label={label}
        />
      </div>
      <span className="text-[rgba(255,255,255,0.3)] text-[10px] w-10 text-right tabular-nums">
        {value.toFixed(step < 1 ? 1 : 0)}{unit}
      </span>
    </div>
  );
}

const EQ_LABELS = ["80", "250", "1k", "4k", "12k"];

export function ChannelStrip({
  stemId,
  name,
  color,
  classification,
  params,
  onParamChange,
  onMuteToggle,
  onSoloToggle,
  isEffectivelyMuted,
}: ChannelStripProps) {
  const [eqOpen, setEqOpen] = useState(false);
  const [compOpen, setCompOpen] = useState(false);

  return (
    <div
      className={`w-48 shrink-0 rounded-xl bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] p-3 flex flex-col gap-2 ${
        isEffectivelyMuted ? "opacity-40" : ""
      }`}
    >
      {/* Header: color + name + classification */}
      <div className="flex items-center gap-2">
        <div
          data-testid="stem-color-indicator"
          className="w-2 h-8 rounded-full shrink-0"
          style={{ backgroundColor: color }}
        />
        <div className="min-w-0">
          <p className="text-white text-xs truncate">{name}</p>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.5)] capitalize">
            {classification}
          </span>
        </div>
      </div>

      {/* Volume */}
      <Slider
        label="Volume"
        value={params.volume}
        min={-60}
        max={12}
        step={0.5}
        unit="dB"
        onChange={(v) => onParamChange(stemId, "volume", v)}
      />

      {/* Pan */}
      <Slider
        label="Pan"
        value={params.pan}
        min={-1}
        max={1}
        step={0.01}
        unit=""
        onChange={(v) => onParamChange(stemId, "pan", v)}
      />

      {/* Mute / Solo */}
      <div className="flex gap-1">
        <button
          onClick={() => onMuteToggle(stemId)}
          aria-label="Mute"
          aria-pressed={params.mute}
          className={`flex-1 py-1 rounded text-[10px] font-medium transition-colors ${
            params.mute
              ? "bg-red-500/30 text-red-400 border border-red-500/40"
              : "bg-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.4)] hover:text-white"
          }`}
        >
          M
        </button>
        <button
          onClick={() => onSoloToggle(stemId)}
          aria-label="Solo"
          aria-pressed={params.solo}
          className={`flex-1 py-1 rounded text-[10px] font-medium transition-colors ${
            params.solo
              ? "bg-yellow-500/30 text-yellow-400 border border-yellow-500/40"
              : "bg-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.4)] hover:text-white"
          }`}
        >
          S
        </button>
      </div>

      {/* EQ (collapsible) */}
      <button
        onClick={() => setEqOpen(!eqOpen)}
        className="flex items-center justify-between text-[rgba(255,255,255,0.5)] text-[10px] hover:text-white transition-colors"
      >
        <span>EQ</span>
        {eqOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {eqOpen && (
        <div className="flex flex-col gap-1">
          {EQ_LABELS.map((label, i) => (
            <Slider
              key={label}
              label={label}
              value={params.eq[i]}
              min={-12}
              max={12}
              step={0.5}
              unit="dB"
              onChange={(v) => {
                const newEq = [...params.eq] as [number, number, number, number, number];
                newEq[i] = v;
                onParamChange(stemId, "eq", newEq);
              }}
            />
          ))}
        </div>
      )}

      {/* Compressor (collapsible) */}
      <button
        onClick={() => setCompOpen(!compOpen)}
        className="flex items-center justify-between text-[rgba(255,255,255,0.5)] text-[10px] hover:text-white transition-colors"
      >
        <span>Compressor</span>
        {compOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {compOpen && (
        <div className="flex flex-col gap-1">
          <Slider label="Thresh" value={params.compThreshold} min={-60} max={0} step={1} unit="dB" onChange={(v) => onParamChange(stemId, "compThreshold", v)} />
          <Slider label="Ratio" value={params.compRatio} min={1} max={20} step={0.5} unit=":1" onChange={(v) => onParamChange(stemId, "compRatio", v)} />
          <Slider label="Attack" value={params.compAttack} min={0.1} max={100} step={0.1} unit="ms" onChange={(v) => onParamChange(stemId, "compAttack", v)} />
          <Slider label="Release" value={params.compRelease} min={10} max={1000} step={1} unit="ms" onChange={(v) => onParamChange(stemId, "compRelease", v)} />
          <Slider label="Makeup" value={params.compMakeup} min={0} max={24} step={0.5} unit="dB" onChange={(v) => onParamChange(stemId, "compMakeup", v)} />
        </div>
      )}

      {/* Saturation */}
      <Slider
        label="Drive"
        value={params.satDrive}
        min={0}
        max={100}
        step={1}
        unit="%"
        onChange={(v) => onParamChange(stemId, "satDrive", v)}
      />
    </div>
  );
}
