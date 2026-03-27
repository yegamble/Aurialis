"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

interface AdvancedMasteringProps {
  params: Record<string, number>;
  onParamChange: (key: string, val: number) => void;
  dynamics: { deharsh: boolean; glueComp: boolean };
  onDynamicsToggle: (key: "deharsh" | "glueComp") => void;
  tonePreset: string;
  onTonePresetChange: (preset: string) => void;
  outputPreset: string;
  onOutputPresetChange: (preset: string) => void;
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
    <div className="flex items-center gap-3">
      <span className="text-[rgba(255,255,255,0.5)] text-xs w-24 shrink-0">
        {label}
      </span>
      <div className="flex-1 relative h-8 flex items-center">
        <div className="w-full h-1 rounded-full bg-[rgba(255,255,255,0.08)]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#0a84ff] to-[#5ac8fa]"
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
        {/* Thumb visual */}
        <div
          className="absolute w-4 h-4 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.4)] pointer-events-none"
          style={{
            left: `calc(${pct}% - 8px)`,
            top: "50%",
            transform: "translateY(-50%)",
          }}
        />
      </div>
      <span className="text-[rgba(255,255,255,0.6)] text-xs w-16 text-right tabular-nums">
        {value.toFixed(step < 1 ? 1 : 0)} {unit}
      </span>
    </div>
  );
}

function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-[rgba(255,255,255,0.06)] pb-4">
      <button
        className="flex items-center justify-between w-full py-2 text-left"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="text-[rgba(255,255,255,0.6)] text-xs uppercase tracking-wider">
          {title}
        </span>
        {open ? (
          <ChevronUp className="w-3.5 h-3.5 text-[rgba(255,255,255,0.3)]" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-[rgba(255,255,255,0.3)]" />
        )}
      </button>
      {open && <div className="space-y-3 mt-1">{children}</div>}
    </div>
  );
}

function ToggleButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`px-3 py-2 rounded-xl text-xs transition-all flex-1
        ${
          active
            ? "bg-[#0a84ff]/[0.15] border border-[#0a84ff]/30 text-[#0a84ff]"
            : "bg-[rgba(255,255,255,0.04)] border border-transparent text-[rgba(255,255,255,0.5)] hover:bg-[rgba(255,255,255,0.06)]"
        }
      `}
    >
      {label}
    </button>
  );
}

export function AdvancedMastering({
  params,
  onParamChange,
  dynamics,
  onDynamicsToggle,
  tonePreset,
  onTonePresetChange,
  outputPreset,
  onOutputPresetChange,
}: AdvancedMasteringProps) {
  return (
    <div className="space-y-4 p-1 overflow-y-auto max-h-[calc(100vh-200px)]">
      {/* Input */}
      <Section title="Input">
        <Slider
          label="Input Gain"
          value={params.inputGain ?? 0}
          min={-24}
          max={24}
          step={0.1}
          unit="dB"
          onChange={(v) => onParamChange("inputGain", v)}
        />
      </Section>

      {/* Dynamics */}
      <Section title="Dynamics">
        <div className="flex gap-2 mb-3">
          <ToggleButton
            label="De-Harsh"
            active={dynamics.deharsh}
            onClick={() => onDynamicsToggle("deharsh")}
          />
          <ToggleButton
            label="Glue Comp"
            active={dynamics.glueComp}
            onClick={() => onDynamicsToggle("glueComp")}
          />
        </div>
        <Slider
          label="Threshold"
          value={params.threshold ?? -18}
          min={-40}
          max={0}
          step={0.1}
          unit="dB"
          onChange={(v) => onParamChange("threshold", v)}
        />
        <Slider
          label="Ratio"
          value={params.ratio ?? 3}
          min={1}
          max={20}
          step={0.1}
          unit=":1"
          onChange={(v) => onParamChange("ratio", v)}
        />
        <Slider
          label="Attack"
          value={params.attack ?? 20}
          min={0.1}
          max={100}
          step={0.1}
          unit="ms"
          onChange={(v) => onParamChange("attack", v)}
        />
        <Slider
          label="Release"
          value={params.release ?? 250}
          min={10}
          max={1000}
          step={1}
          unit="ms"
          onChange={(v) => onParamChange("release", v)}
        />
        <Slider
          label="Makeup"
          value={params.makeup ?? 0}
          min={-12}
          max={12}
          step={0.1}
          unit="dB"
          onChange={(v) => onParamChange("makeup", v)}
        />
      </Section>

      {/* Tone */}
      <Section title="Tone">
        <div className="flex gap-2 mb-3">
          {["Add Air", "Tape Warmth", "Cut Mud"].map((p) => (
            <ToggleButton
              key={p}
              label={p}
              active={tonePreset === p}
              onClick={() => onTonePresetChange(p)}
            />
          ))}
        </div>
      </Section>

      {/* EQ */}
      <Section title="Parametric EQ">
        {[
          { key: "eq80", label: "80 Hz" },
          { key: "eq250", label: "250 Hz" },
          { key: "eq1k", label: "1 kHz" },
          { key: "eq4k", label: "4 kHz" },
          { key: "eq12k", label: "12 kHz" },
        ].map((band) => (
          <Slider
            key={band.key}
            label={band.label}
            value={params[band.key] ?? 0}
            min={-12}
            max={12}
            step={0.1}
            unit="dB"
            onChange={(v) => onParamChange(band.key, v)}
          />
        ))}
      </Section>

      {/* Saturation */}
      <Section title="Saturation" defaultOpen={false}>
        <Slider
          label="Drive"
          value={params.satDrive ?? 40}
          min={0}
          max={100}
          step={1}
          unit="%"
          onChange={(v) => onParamChange("satDrive", v)}
        />
      </Section>

      {/* Stereo */}
      <Section title="Stereo" defaultOpen={false}>
        <Slider
          label="Width"
          value={params.stereoWidth ?? 100}
          min={0}
          max={200}
          step={1}
          unit="%"
          onChange={(v) => onParamChange("stereoWidth", v)}
        />
        <Slider
          label="Bass Mono Freq"
          value={params.bassMonoFreq ?? 200}
          min={50}
          max={500}
          step={1}
          unit="Hz"
          onChange={(v) => onParamChange("bassMonoFreq", v)}
        />
        <Slider
          label="Mid Gain"
          value={params.midGain ?? 0}
          min={-12}
          max={12}
          step={0.1}
          unit="dB"
          onChange={(v) => onParamChange("midGain", v)}
        />
        <Slider
          label="Side Gain"
          value={params.sideGain ?? 0}
          min={-12}
          max={12}
          step={0.1}
          unit="dB"
          onChange={(v) => onParamChange("sideGain", v)}
        />
      </Section>

      {/* Output / Limiter */}
      <Section title="Output">
        <div className="flex gap-2 mb-3 flex-wrap">
          {["Spotify", "Apple Music", "YouTube", "SoundCloud", "CD"].map(
            (p) => (
              <button
                key={p}
                onClick={() => onOutputPresetChange(p)}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] transition-all
                ${
                  outputPreset === p
                    ? "bg-[#0a84ff]/[0.15] text-[#0a84ff]"
                    : "text-[rgba(255,255,255,0.4)] hover:text-[rgba(255,255,255,0.6)]"
                }
              `}
                aria-pressed={outputPreset === p}
              >
                {p}
              </button>
            )
          )}
        </div>
        <Slider
          label="Target LUFS"
          value={params.targetLufs ?? -14}
          min={-24}
          max={-6}
          step={0.1}
          unit="LUFS"
          onChange={(v) => onParamChange("targetLufs", v)}
        />
        <Slider
          label="Ceiling"
          value={params.ceiling ?? -1}
          min={-6}
          max={0}
          step={0.1}
          unit="dBTP"
          onChange={(v) => onParamChange("ceiling", v)}
        />
        <Slider
          label="Release"
          value={params.limiterRelease ?? 100}
          min={10}
          max={500}
          step={1}
          unit="ms"
          onChange={(v) => onParamChange("limiterRelease", v)}
        />
      </Section>
    </div>
  );
}
