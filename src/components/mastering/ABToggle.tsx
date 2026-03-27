"use client";

interface ABToggleProps {
  isActive: boolean;
  onToggle: () => void;
}

/**
 * A/B comparison toggle button.
 * A = processed signal (normal), B = bypassed (dry) signal.
 */
export function ABToggle({ isActive, onToggle }: ABToggleProps) {
  return (
    <button
      onClick={onToggle}
      data-testid="ab-toggle"
      aria-pressed={isActive}
      aria-label={isActive ? "Bypass active — click to restore processing" : "Click to compare bypass"}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
        isActive
          ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
          : "bg-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.5)] hover:text-[rgba(255,255,255,0.7)] border border-transparent"
      }`}
    >
      <span className="text-[10px] font-bold tracking-wider">
        {isActive ? "B" : "A"}
      </span>
      <span>{isActive ? "Bypass" : "Processed"}</span>
    </button>
  );
}
