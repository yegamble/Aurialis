"use client";

import { memo, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type {
  AudioParams,
  EqBandMode,
  EqBandType,
} from "@/types/mastering";

export type LegacyEqGainKey = "eq80" | "eq250" | "eq1k" | "eq4k" | "eq12k";
const LEGACY_KEYS: readonly LegacyEqGainKey[] = [
  "eq80",
  "eq250",
  "eq1k",
  "eq4k",
  "eq12k",
];

const TYPE_OPTIONS: readonly { value: EqBandType; label: string }[] = [
  { value: "bell", label: "Bell" },
  { value: "lowShelf", label: "Low Shelf" },
  { value: "highShelf", label: "High Shelf" },
  { value: "highPass", label: "High-Pass" },
  { value: "lowPass", label: "Low-Pass" },
];

const MODE_OPTIONS: readonly { value: EqBandMode; label: string }[] = [
  { value: "stereo", label: "Stereo" },
  { value: "ms", label: "M/S" },
];

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
  testId,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
  testId?: string;
}): React.ReactElement {
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
          data-testid={testId}
        />
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
        {value.toFixed(step < 1 ? 2 : 0)} {unit}
      </span>
    </div>
  );
}

function Pills<T extends string>({
  ariaLabel,
  options,
  value,
  onChange,
  testIdPrefix,
}: {
  ariaLabel: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  testIdPrefix?: string;
}): React.ReactElement {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const handleKey = (e: React.KeyboardEvent<HTMLButtonElement>, idx: number): void => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const delta = e.key === "ArrowRight" ? 1 : -1;
    const nextIdx = (idx + delta + options.length) % options.length;
    onChange(options[nextIdx].value);
    buttonRefs.current[nextIdx]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="flex flex-wrap gap-1 mb-2"
    >
      {options.map((opt, idx) => (
        <button
          key={opt.value}
          ref={(el) => {
            buttonRefs.current[idx] = el;
          }}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          tabIndex={value === opt.value ? 0 : -1}
          onClick={() => onChange(opt.value)}
          onKeyDown={(e) => handleKey(e, idx)}
          data-testid={testIdPrefix ? `${testIdPrefix}-${opt.value}` : undefined}
          className={`
            flex-1 px-2 py-1 text-[11px] rounded-md border transition-colors
            ${
              value === opt.value
                ? "bg-[rgba(255,255,255,0.12)] border-[rgba(255,255,255,0.25)] text-white"
                : "bg-transparent border-[rgba(255,255,255,0.08)] text-[rgba(255,255,255,0.55)] hover:bg-[rgba(255,255,255,0.05)]"
            }
          `}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export type EqBandStripProps = {
  bandIndex: 0 | 1 | 2 | 3 | 4;
  defaultOpen?: boolean;
  params: AudioParams;
  onParamChange: <K extends keyof AudioParams>(key: K, val: AudioParams[K]) => void;
};

/**
 * One parametric-EQ band. Exposes Freq / Q / Gain sliders, Enable toggle,
 * Type pills, Mode pills, and a conditional MS Balance slider when mode="ms".
 * Gain is stored on the legacy `eq80/eq250/eq1k/eq4k/eq12k` fields
 * (Band 1..5) so ui-presets offsets keep working.
 */
function EqBandStripImpl({
  bandIndex,
  defaultOpen = false,
  params,
  onParamChange,
}: EqBandStripProps): React.ReactElement {
  const [open, setOpen] = useState(defaultOpen);
  const bandNum = bandIndex + 1;
  const enabledKey = `eqBand${bandNum}Enabled` as keyof AudioParams;
  const freqKey = `eqBand${bandNum}Freq` as keyof AudioParams;
  const qKey = `eqBand${bandNum}Q` as keyof AudioParams;
  const typeKey = `eqBand${bandNum}Type` as keyof AudioParams;
  const modeKey = `eqBand${bandNum}Mode` as keyof AudioParams;
  const balanceKey = `eqBand${bandNum}MsBalance` as keyof AudioParams;
  const gainKey: LegacyEqGainKey = LEGACY_KEYS[bandIndex];

  const enabled = ((params[enabledKey] as number) ?? 1) > 0;
  const mode = ((params[modeKey] as EqBandMode) ?? "stereo");
  const freq = ((params[freqKey] as number) ?? 1000);
  const q = ((params[qKey] as number) ?? 1);
  const gain = ((params[gainKey] as number) ?? 0);
  const type = ((params[typeKey] as EqBandType) ?? "bell");
  const balance = ((params[balanceKey] as number) ?? 0);

  return (
    <div
      className="border border-[rgba(255,255,255,0.06)] rounded-lg p-2"
      data-testid={`eq-band-${bandNum}`}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="flex items-center gap-1 flex-1 text-left"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls={`eq-band-${bandNum}-details`}
          aria-label={`Band ${bandNum} header`}
          data-testid={`eq-band-${bandNum}-toggle`}
        >
          {open ? (
            <ChevronUp className="w-3.5 h-3.5 text-[rgba(255,255,255,0.3)]" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-[rgba(255,255,255,0.3)]" />
          )}
          <span className="text-[rgba(255,255,255,0.7)] text-xs font-medium">
            Band {bandNum}
          </span>
          <span className="text-[rgba(255,255,255,0.4)] text-[10px] ml-2">
            {Math.round(freq)} Hz · {type} · {gain.toFixed(1)} dB
          </span>
        </button>
        <button
          type="button"
          onClick={() => onParamChange(enabledKey, enabled ? 0 : 1)}
          aria-pressed={enabled}
          aria-label={`Band ${bandNum} enable`}
          data-testid={`eq-band-${bandNum}-enable`}
          className={`px-2 py-1 rounded text-[10px] transition-colors ${
            enabled
              ? "bg-[#0a84ff]/[0.15] text-[#0a84ff]"
              : "bg-[rgba(255,255,255,0.04)] text-[rgba(255,255,255,0.5)]"
          }`}
        >
          {enabled ? "ON" : "OFF"}
        </button>
      </div>
      {open && (
        <div
          id={`eq-band-${bandNum}-details`}
          className="space-y-2 mt-2 pl-1"
        >
          <Pills
            ariaLabel={`Band ${bandNum} filter type`}
            options={TYPE_OPTIONS}
            value={type}
            onChange={(v) => onParamChange(typeKey, v)}
            testIdPrefix={`eq-band-${bandNum}-type`}
          />
          <Slider
            label="Frequency"
            value={freq}
            min={20}
            max={20000}
            step={1}
            unit="Hz"
            onChange={(v) => onParamChange(freqKey, v)}
            testId={`eq-band-${bandNum}-freq`}
          />
          <Slider
            label="Q"
            value={q}
            min={0.1}
            max={10}
            step={0.01}
            unit=""
            onChange={(v) => onParamChange(qKey, v)}
            testId={`eq-band-${bandNum}-q`}
          />
          <Slider
            label="Gain"
            value={gain}
            min={-12}
            max={12}
            step={0.1}
            unit="dB"
            onChange={(v) => onParamChange(gainKey, v)}
            testId={`eq-band-${bandNum}-gain`}
          />
          <Pills
            ariaLabel={`Band ${bandNum} channel mode`}
            options={MODE_OPTIONS}
            value={mode}
            onChange={(v) => onParamChange(modeKey, v)}
            testIdPrefix={`eq-band-${bandNum}-mode`}
          />
          {mode === "ms" && (
            <Slider
              label="M/S Balance"
              value={balance}
              min={-1}
              max={1}
              step={0.01}
              unit=""
              onChange={(v) => onParamChange(balanceKey, v)}
              testId={`eq-band-${bandNum}-msbalance`}
            />
          )}
        </div>
      )}
    </div>
  );
}

export const EqBandStrip = memo(EqBandStripImpl);
