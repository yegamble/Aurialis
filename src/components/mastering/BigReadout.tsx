"use client";

import type { ReactElement } from "react";

export interface BigReadoutProps {
  label: string;
  value: string | number | null | undefined;
  sub?: string;
  warn?: boolean;
  emphasized?: boolean;
}

export function BigReadout({
  label,
  value,
  sub,
  warn = false,
  emphasized = false,
}: BigReadoutProps): ReactElement {
  const display =
    value === null || value === undefined || value === "" ? "—" : String(value);
  const valueClass = [
    "text-2xl font-medium tabular-nums leading-none tracking-tight",
    warn ? "text-red-400" : emphasized ? "text-[#0a84ff]" : "text-white",
  ].join(" ");
  return (
    <div
      data-testid="big-readout"
      data-emphasized={emphasized ? "true" : undefined}
      className={
        "flex flex-col gap-1 rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(28,28,30,0.6)] px-3.5 py-3"
      }
    >
      <span
        data-testid="big-readout-label"
        className="text-[10px] font-semibold uppercase tracking-wider text-[rgba(255,255,255,0.5)]"
      >
        {label}
      </span>
      <span
        data-testid="big-readout-value"
        data-warn={warn ? "true" : undefined}
        className={valueClass}
      >
        {display}
      </span>
      {sub ? (
        <span
          data-testid="big-readout-sub"
          className="text-[10px] text-[rgba(255,255,255,0.45)]"
        >
          {sub}
        </span>
      ) : null}
    </div>
  );
}
