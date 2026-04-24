"use client";

import { useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type {
  AudioParams,
  MultibandMode,
  SaturationMode,
} from "@/types/mastering";
import type { TonePresetName, OutputPresetName } from "@/lib/audio/ui-presets";
import { EqBandStrip } from "./EqBandStrip";

interface AdvancedMasteringProps {
  params: AudioParams;
  onParamChange: <K extends keyof AudioParams>(key: K, val: AudioParams[K]) => void;
  dynamics: { deharsh: boolean; glueComp: boolean };
  onDynamicsToggle: (key: "deharsh" | "glueComp") => void;
  tonePreset: TonePresetName | null;
  onTonePresetChange: (preset: TonePresetName) => void;
  outputPreset: OutputPresetName | null;
  onOutputPresetChange: (preset: OutputPresetName) => void;
}

/** Segmented radiogroup pill selector for SaturationMode. */
function SatModePills({
  value,
  onChange,
}: {
  value: SaturationMode;
  onChange: (v: SaturationMode) => void;
}) {
  const modes: readonly SaturationMode[] = [
    "clean",
    "tube",
    "tape",
    "transformer",
  ];
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const handleKey = (e: React.KeyboardEvent<HTMLButtonElement>, idx: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const delta = e.key === "ArrowRight" ? 1 : -1;
    const nextIdx = (idx + delta + modes.length) % modes.length;
    const next = modes[nextIdx];
    onChange(next);
    buttonRefs.current[nextIdx]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Saturation mode"
      className="flex gap-1 mb-3"
    >
      {modes.map((mode, idx) => (
        <button
          key={mode}
          ref={(el) => {
            buttonRefs.current[idx] = el;
          }}
          type="button"
          role="radio"
          aria-checked={value === mode}
          tabIndex={value === mode ? 0 : -1}
          onClick={() => onChange(mode)}
          onKeyDown={(e) => handleKey(e, idx)}
          className={`
            flex-1 px-2 py-1.5 text-xs rounded-md border transition-colors
            ${
              value === mode
                ? "bg-[rgba(255,255,255,0.12)] border-[rgba(255,255,255,0.25)] text-white"
                : "bg-transparent border-[rgba(255,255,255,0.08)] text-[rgba(255,255,255,0.55)] hover:bg-[rgba(255,255,255,0.05)]"
            }
          `}
        >
          {mode.charAt(0).toUpperCase() + mode.slice(1)}
        </button>
      ))}
    </div>
  );
}

/** Segmented radiogroup pill selector for MultibandMode (Stereo | M/S). */
function ModePills({
  value,
  onChange,
}: {
  value: MultibandMode;
  onChange: (v: MultibandMode) => void;
}) {
  const modes: readonly MultibandMode[] = ["stereo", "ms"];
  const labels: Record<MultibandMode, string> = {
    stereo: "Stereo",
    ms: "M/S",
  };
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const handleKey = (e: React.KeyboardEvent<HTMLButtonElement>, idx: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const delta = e.key === "ArrowRight" ? 1 : -1;
    const nextIdx = (idx + delta + modes.length) % modes.length;
    const next = modes[nextIdx];
    onChange(next);
    buttonRefs.current[nextIdx]?.focus();
  };

  return (
    <div role="radiogroup" aria-label="Band mode" className="flex gap-1 mb-2">
      {modes.map((mode, idx) => (
        <button
          key={mode}
          ref={(el) => {
            buttonRefs.current[idx] = el;
          }}
          type="button"
          role="radio"
          aria-checked={value === mode}
          tabIndex={value === mode ? 0 : -1}
          onClick={() => onChange(mode)}
          onKeyDown={(e) => handleKey(e, idx)}
          className={`
            flex-1 px-2 py-1 text-[11px] rounded-md border transition-colors
            ${
              value === mode
                ? "bg-[rgba(255,255,255,0.12)] border-[rgba(255,255,255,0.25)] text-white"
                : "bg-transparent border-[rgba(255,255,255,0.08)] text-[rgba(255,255,255,0.55)] hover:bg-[rgba(255,255,255,0.05)]"
            }
          `}
        >
          {labels[mode]}
        </button>
      ))}
    </div>
  );
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
  rightSlot,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  /** Content rendered on the right of the header (e.g., a BypassPill). */
  rightSlot?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-[rgba(255,255,255,0.06)] pb-4">
      <div className="flex items-center gap-2 py-2">
        <button
          className="flex items-center justify-between flex-1 text-left"
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
        {rightSlot}
      </div>
      {open && <div className="space-y-3 mt-1">{children}</div>}
    </div>
  );
}

/**
 * Per-stage A/B bypass pill. Supplements the global ABToggle in the
 * transport bar — each stage can be bypassed independently. State is held
 * in the corresponding `AudioParams` `*Enabled` field.
 */
function BypassPill({
  active,
  onToggle,
  testId,
  stageLabel,
}: {
  /** True when the stage is bypassed (enabled=0). */
  active: boolean;
  onToggle: () => void;
  testId: string;
  stageLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-pressed={active}
      aria-label={
        active ? `${stageLabel} bypassed — click to restore` : `Bypass ${stageLabel}`
      }
      data-testid={testId}
      className={`px-3 py-1 rounded text-[10px] transition-colors ${
        active
          ? "bg-yellow-500/[0.18] text-yellow-300"
          : "bg-[rgba(255,255,255,0.04)] text-[rgba(255,255,255,0.5)]"
      }`}
    >
      {active ? "Bypassed" : "Bypass"}
    </button>
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

type BandPrefix = "mbLow" | "mbMid" | "mbHigh";

interface BandRowProps {
  label: "Low" | "Mid" | "High";
  prefix: BandPrefix;
  params: AudioParams;
  onParamChange: <K extends keyof AudioParams>(
    key: K,
    val: AudioParams[K]
  ) => void;
}

function BandRow({ label, prefix, params, onParamChange }: BandRowProps) {
  const [open, setOpen] = useState(false);
  const enabledKey = `${prefix}Enabled` as const;
  const soloKey = `${prefix}Solo` as const;
  const thresholdKey = `${prefix}Threshold` as const;
  const ratioKey = `${prefix}Ratio` as const;
  const attackKey = `${prefix}Attack` as const;
  const releaseKey = `${prefix}Release` as const;
  const makeupKey = `${prefix}Makeup` as const;
  const modeKey = `${prefix}Mode` as const;
  const msBalanceKey = `${prefix}MsBalance` as const;

  const enabled = (params[enabledKey] ?? 0) > 0;
  const solo = (params[soloKey] ?? 0) > 0;
  const mode = (params[modeKey] ?? "stereo") as MultibandMode;

  return (
    <div className="border border-[rgba(255,255,255,0.06)] rounded-lg p-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="flex items-center gap-1 flex-1 text-left"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          {open ? (
            <ChevronUp className="w-3.5 h-3.5 text-[rgba(255,255,255,0.3)]" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-[rgba(255,255,255,0.3)]" />
          )}
          <span className="text-[rgba(255,255,255,0.7)] text-xs font-medium">
            {label}
          </span>
        </button>
        <button
          type="button"
          onClick={() => onParamChange(enabledKey, enabled ? 0 : 1)}
          aria-pressed={enabled}
          aria-label={`${label} band enable`}
          className={`px-2 py-1 rounded text-[10px] transition-colors ${
            enabled
              ? "bg-[#0a84ff]/[0.15] text-[#0a84ff]"
              : "bg-[rgba(255,255,255,0.04)] text-[rgba(255,255,255,0.5)]"
          }`}
        >
          {enabled ? "ON" : "OFF"}
        </button>
        <button
          type="button"
          onClick={() => onParamChange(soloKey, solo ? 0 : 1)}
          aria-pressed={solo}
          aria-label={`${label} band solo`}
          className={`px-2 py-1 rounded text-[10px] transition-colors ${
            solo
              ? "bg-yellow-500/[0.18] text-yellow-300"
              : "bg-[rgba(255,255,255,0.04)] text-[rgba(255,255,255,0.5)]"
          }`}
        >
          S
        </button>
      </div>
      {open && (
        <div className="space-y-2 mt-2 pl-1">
          <ModePills
            value={mode}
            onChange={(v) => onParamChange(modeKey, v)}
          />
          <Slider
            label="Threshold"
            value={params[thresholdKey] ?? -18}
            min={-60}
            max={0}
            step={0.1}
            unit="dB"
            onChange={(v) => onParamChange(thresholdKey, v)}
          />
          <Slider
            label="Ratio"
            value={params[ratioKey] ?? 2}
            min={1}
            max={20}
            step={0.1}
            unit=":1"
            onChange={(v) => onParamChange(ratioKey, v)}
          />
          <Slider
            label="Attack"
            value={params[attackKey] ?? 20}
            min={0.1}
            max={100}
            step={0.1}
            unit="ms"
            onChange={(v) => onParamChange(attackKey, v)}
          />
          <Slider
            label="Release"
            value={params[releaseKey] ?? 250}
            min={10}
            max={1000}
            step={1}
            unit="ms"
            onChange={(v) => onParamChange(releaseKey, v)}
          />
          <Slider
            label="Makeup"
            value={params[makeupKey] ?? 0}
            min={-12}
            max={12}
            step={0.1}
            unit="dB"
            onChange={(v) => onParamChange(makeupKey, v)}
          />
          {mode === "ms" && (
            <Slider
              label="M/S Balance"
              value={params[msBalanceKey] ?? 0}
              min={-1}
              max={1}
              step={0.01}
              unit=""
              onChange={(v) => onParamChange(msBalanceKey, v)}
            />
          )}
        </div>
      )}
    </div>
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

      {/* Compressor (split from former "Dynamics" in Phase 4a Task 5) */}
      <Section
        title="Compressor"
        rightSlot={
          <BypassPill
            testId="bypass-pill-compressor"
            stageLabel="Compressor"
            active={(params.compressorEnabled ?? 1) === 0}
            onToggle={() =>
              onParamChange(
                "compressorEnabled",
                (params.compressorEnabled ?? 1) > 0 ? 0 : 1
              )
            }
          />
        }
      >
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
        <Slider
          label="Sidechain HPF"
          value={params.sidechainHpfHz ?? 100}
          min={20}
          max={300}
          step={1}
          unit="Hz"
          onChange={(v) => onParamChange("sidechainHpfHz", v)}
        />
      </Section>

      {/* Dynamics Toggles (split from former "Dynamics") */}
      <Section title="Dynamics Toggles">
        <div className="flex gap-2">
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
          <ToggleButton
            label="Auto Release"
            active={(params.autoRelease ?? 0) > 0}
            onClick={() =>
              onParamChange(
                "autoRelease",
                (params.autoRelease ?? 0) > 0 ? 0 : 1
              )
            }
          />
        </div>
      </Section>

      {/* Multiband */}
      <Section
        title="Multiband"
        defaultOpen={false}
        rightSlot={
          <BypassPill
            testId="bypass-pill-multiband"
            stageLabel="Multiband"
            active={(params.multibandEnabled ?? 0) === 0}
            onToggle={() =>
              onParamChange(
                "multibandEnabled",
                (params.multibandEnabled ?? 0) > 0 ? 0 : 1
              )
            }
          />
        }
      >
        <Slider
          label="Low|Mid"
          value={params.mbCrossLowMid ?? 200}
          min={80}
          max={400}
          step={1}
          unit="Hz"
          onChange={(v) =>
            onParamChange(
              "mbCrossLowMid",
              Math.min(v, (params.mbCrossMidHigh ?? 2000) - 50)
            )
          }
        />
        <Slider
          label="Mid|High"
          value={params.mbCrossMidHigh ?? 2000}
          min={800}
          max={4000}
          step={1}
          unit="Hz"
          onChange={(v) =>
            onParamChange(
              "mbCrossMidHigh",
              Math.max(v, (params.mbCrossLowMid ?? 200) + 50)
            )
          }
        />
        <div
          className="space-y-2 mt-2"
          style={{
            opacity: (params.multibandEnabled ?? 0) > 0 ? 1 : 0.55,
          }}
        >
          <BandRow
            label="Low"
            prefix="mbLow"
            params={params}
            onParamChange={onParamChange}
          />
          <BandRow
            label="Mid"
            prefix="mbMid"
            params={params}
            onParamChange={onParamChange}
          />
          <BandRow
            label="High"
            prefix="mbHigh"
            params={params}
            onParamChange={onParamChange}
          />
        </div>
      </Section>

      {/* Tone */}
      <Section title="Tone">
        <div className="flex gap-2 mb-3">
          {(["Add Air", "Tape Warmth", "Cut Mud"] as const).map((p) => (
            <ToggleButton
              key={p}
              label={p}
              active={tonePreset === p}
              onClick={() => onTonePresetChange(p)}
            />
          ))}
        </div>
      </Section>

      {/* Parametric EQ — 5 sweepable bands (P3); bypass pill moved to header in Phase 4a Task 5 */}
      <Section
        title="Parametric EQ"
        rightSlot={
          <BypassPill
            testId="bypass-pill-eq"
            stageLabel="EQ"
            active={(params.parametricEqEnabled ?? 1) === 0}
            onToggle={() =>
              onParamChange(
                "parametricEqEnabled",
                (params.parametricEqEnabled ?? 1) > 0 ? 0 : 1,
              )
            }
          />
        }
      >
        <div className="space-y-2">
          {([0, 1, 2, 3, 4] as const).map((idx) => (
            <EqBandStrip
              key={idx}
              bandIndex={idx}
              defaultOpen={idx === 0}
              params={params}
              onParamChange={onParamChange}
            />
          ))}
        </div>
      </Section>

      {/* Saturation */}
      <Section
        title="Saturation"
        defaultOpen={false}
        rightSlot={
          <BypassPill
            testId="bypass-pill-saturation"
            stageLabel="Saturation"
            active={(params.saturationEnabled ?? 1) === 0}
            onToggle={() =>
              onParamChange(
                "saturationEnabled",
                (params.saturationEnabled ?? 1) > 0 ? 0 : 1
              )
            }
          />
        }
      >
        <SatModePills
          value={params.satMode ?? "clean"}
          onChange={(v) => onParamChange("satMode", v)}
        />
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
      <Section
        title="Stereo"
        defaultOpen={false}
        rightSlot={
          <BypassPill
            testId="bypass-pill-stereo-width"
            stageLabel="Stereo Width"
            active={(params.stereoWidthEnabled ?? 1) === 0}
            onToggle={() =>
              onParamChange(
                "stereoWidthEnabled",
                (params.stereoWidthEnabled ?? 1) > 0 ? 0 : 1
              )
            }
          />
        }
      >
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

      {/* Limiter (split from former "Output" in Phase 4a Task 5) */}
      <Section
        title="Limiter"
        rightSlot={
          <BypassPill
            testId="bypass-pill-limiter"
            stageLabel="Limiter"
            active={(params.limiterEnabled ?? 1) === 0}
            onToggle={() =>
              onParamChange(
                "limiterEnabled",
                (params.limiterEnabled ?? 1) > 0 ? 0 : 1
              )
            }
          />
        }
      >
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
          label="Limiter Release"
          value={params.limiterRelease ?? 100}
          min={10}
          max={500}
          step={1}
          unit="ms"
          onChange={(v) => onParamChange("limiterRelease", v)}
        />
      </Section>

      {/* Output Target (split from former "Output"; platform pills + Target LUFS) */}
      <Section title="Output Target">
        <div className="flex gap-2 mb-3 flex-wrap">
          {(["Spotify", "Apple Music", "YouTube", "SoundCloud", "CD"] as const).map(
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
      </Section>
    </div>
  );
}
