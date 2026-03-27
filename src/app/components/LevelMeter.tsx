import { motion } from "motion/react";

interface LevelMeterProps {
  leftLevel: number;
  rightLevel: number;
  lufs: number;
  truePeak: number;
  dynamicRange: number;
  target: number;
}

export function LevelMeter({
  leftLevel,
  rightLevel,
  lufs,
  truePeak,
  dynamicRange,
  target,
}: LevelMeterProps) {
  const MeterBar = ({ level, label }: { level: number; label: string }) => {
    const clipped = level > 0.95;
    return (
      <div className="flex items-center gap-2">
        <span className="text-[rgba(255,255,255,0.4)] text-xs w-3">{label}</span>
        <div className="flex-1 h-3 rounded-full bg-[rgba(255,255,255,0.06)] overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{
              background: clipped
                ? "linear-gradient(90deg, #30d158, #ffd60a, #ff453a)"
                : "linear-gradient(90deg, #0a84ff, #5ac8fa)",
            }}
            animate={{ width: `${Math.min(level * 100, 100)}%` }}
            transition={{ duration: 0.05 }}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="rounded-2xl bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] p-5 space-y-4">
      <div className="flex items-baseline justify-between">
        <span className="text-[rgba(255,255,255,0.5)] text-xs tracking-wider uppercase">
          Levels
        </span>
        <div className="text-right">
          <span className="text-[2rem] tracking-tight text-[#0a84ff]">
            {lufs.toFixed(1)}
          </span>
          <span className="text-[rgba(255,255,255,0.4)] text-xs ml-1">LUFS</span>
        </div>
      </div>

      <div className="space-y-2">
        <MeterBar level={leftLevel} label="L" />
        <MeterBar level={rightLevel} label="R" />
      </div>

      <div className="grid grid-cols-3 gap-3 pt-2 border-t border-[rgba(255,255,255,0.06)]">
        {[
          { label: "Target", value: `${target.toFixed(1)}`, unit: "LUFS" },
          { label: "True Peak", value: `${truePeak.toFixed(1)}`, unit: "dBTP" },
          { label: "Dynamic Range", value: `${dynamicRange.toFixed(1)}`, unit: "dB" },
        ].map((item) => (
          <div key={item.label} className="text-center">
            <p className="text-[rgba(255,255,255,0.35)] text-[10px] uppercase tracking-wider">
              {item.label}
            </p>
            <p className="text-white text-sm">
              {item.value}
              <span className="text-[rgba(255,255,255,0.4)] text-[10px] ml-0.5">
                {item.unit}
              </span>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
