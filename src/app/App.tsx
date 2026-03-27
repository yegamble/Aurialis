import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ArrowLeft,
  Play,
  Pause,
  SkipBack,
  Headphones,
  Music,
} from "lucide-react";
import { UploadScreen } from "./components/UploadScreen";
import { WaveformDisplay } from "./components/WaveformDisplay";
import { SpectrumDisplay } from "./components/SpectrumDisplay";
import { LevelMeter } from "./components/LevelMeter";
import { SimpleMastering } from "./components/SimpleMastering";
import { AdvancedMastering } from "./components/AdvancedMastering";
import { ExportPanel } from "./components/ExportPanel";

// Generate mock waveform data
function generateWaveform(): number[] {
  const data: number[] = [];
  for (let i = 0; i < 200; i++) {
    const base = 0.3 + Math.random() * 0.4;
    const envelope =
      Math.sin((i / 200) * Math.PI) * 0.3 +
      Math.sin((i / 200) * Math.PI * 3) * 0.15;
    data.push(Math.min(1, Math.max(0.05, base + envelope)));
  }
  return data;
}

function generateSpectrum(): number[] {
  const data: number[] = [];
  for (let i = 0; i < 64; i++) {
    const freq = i / 64;
    const val =
      0.8 * Math.exp(-freq * 2) +
      0.3 * Math.sin(freq * 10) * Math.exp(-freq) +
      Math.random() * 0.05;
    data.push(Math.max(0, Math.min(1, val)));
  }
  return data;
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function App() {
  const [screen, setScreen] = useState<"upload" | "master">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"simple" | "advanced">("simple");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const duration = 92; // 1:32

  // Waveform & spectrum
  const [waveformData] = useState(generateWaveform);
  const [spectrumData, setSpectrumData] = useState(generateSpectrum);

  // Simple mastering state
  const [intensity, setIntensity] = useState(50);
  const [genre, setGenre] = useState("hiphop");
  const [toggles, setToggles] = useState<Record<string, boolean>>({
    cleanup: true,
    warm: true,
    bright: false,
    wide: false,
    loud: false,
  });

  // Advanced mastering state
  const [advParams, setAdvParams] = useState<Record<string, number>>({
    inputGain: 0,
    threshold: -18,
    ratio: 3,
    attack: 20,
    release: 250,
    makeup: 0,
    eq80: 0,
    eq250: 0,
    eq1k: 0,
    eq4k: 0,
    eq12k: 0,
    satDrive: 40,
    stereoWidth: 100,
    bassMonoFreq: 200,
    midGain: 0,
    sideGain: 0,
    targetLufs: -14,
    ceiling: -1,
    limiterRelease: 100,
  });
  const [dynamics, setDynamics] = useState({
    deharsh: true,
    glueComp: true,
  });
  const [tonePreset, setTonePreset] = useState("Tape Warmth");
  const [outputPreset, setOutputPreset] = useState("Spotify");

  // Level meter animation
  const [levels, setLevels] = useState({
    left: 0.72,
    right: 0.68,
  });

  // Playback simulation
  const timerRef = useRef<ReturnType<typeof setInterval>>();
  useEffect(() => {
    if (isPlaying) {
      timerRef.current = setInterval(() => {
        setCurrentTime((t) => {
          if (t >= duration) {
            setIsPlaying(false);
            return 0;
          }
          return t + 0.1;
        });
        setLevels({
          left: 0.5 + Math.random() * 0.35,
          right: 0.5 + Math.random() * 0.35,
        });
        setSpectrumData(generateSpectrum());
      }, 100);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPlaying, duration]);

  const handleFileUploaded = useCallback((f: File) => {
    setFile(f);
    setScreen("master");
  }, []);

  if (screen === "upload") {
    return <UploadScreen onFileUploaded={handleFileUploaded} />;
  }

  return (
    <div className="min-h-screen bg-black flex flex-col">
      {/* Top Bar */}
      <header className="flex items-center justify-between px-5 py-3 border-b border-[rgba(255,255,255,0.06)] bg-[rgba(0,0,0,0.8)] backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <button
            onClick={() => {
              setScreen("upload");
              setFile(null);
              setCurrentTime(0);
              setIsPlaying(false);
            }}
            className="w-8 h-8 rounded-full bg-[rgba(255,255,255,0.06)] flex items-center justify-center hover:bg-[rgba(255,255,255,0.1)] transition-colors"
            aria-label="Back to upload"
          >
            <ArrowLeft className="w-4 h-4 text-[rgba(255,255,255,0.7)]" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-b from-[#0a84ff] to-[#0066cc] flex items-center justify-center">
              <Headphones className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-white text-sm">Waveish</span>
          </div>
        </div>

        {/* Mode Toggle */}
        <div className="flex bg-[rgba(255,255,255,0.06)] rounded-lg p-0.5">
          {(["simple", "advanced"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-4 py-1.5 rounded-md text-xs transition-all capitalize ${
                mode === m
                  ? "bg-[rgba(255,255,255,0.12)] text-white shadow-sm"
                  : "text-[rgba(255,255,255,0.4)] hover:text-[rgba(255,255,255,0.6)]"
              }`}
              aria-pressed={mode === m}
            >
              {m}
            </button>
          ))}
        </div>

        <div className="w-20" /> {/* Spacer for centering */}
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Controls */}
        <aside className="w-80 border-r border-[rgba(255,255,255,0.06)] overflow-y-auto bg-[rgba(255,255,255,0.02)] p-4 shrink-0 hidden lg:block">
          <AnimatePresence mode="wait">
            {mode === "simple" ? (
              <motion.div
                key="simple"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.2 }}
              >
                <SimpleMastering
                  intensity={intensity}
                  onIntensityChange={setIntensity}
                  genre={genre}
                  onGenreChange={setGenre}
                  toggles={toggles}
                  onToggle={(key) =>
                    setToggles((t) => ({ ...t, [key]: !t[key] }))
                  }
                  onAutoMaster={() => setIntensity(65)}
                />
              </motion.div>
            ) : (
              <motion.div
                key="advanced"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.2 }}
              >
                <AdvancedMastering
                  params={advParams}
                  onParamChange={(k, v) =>
                    setAdvParams((p) => ({ ...p, [k]: v }))
                  }
                  dynamics={dynamics}
                  onDynamicsToggle={(k) =>
                    setDynamics((d) => ({ ...d, [k]: !d[k] }))
                  }
                  tonePreset={tonePreset}
                  onTonePresetChange={setTonePreset}
                  outputPreset={outputPreset}
                  onOutputPresetChange={setOutputPreset}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </aside>

        {/* Center - Visualization */}
        <main className="flex-1 flex flex-col p-5 gap-4 overflow-y-auto">
          {/* File Info */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[rgba(255,255,255,0.06)] flex items-center justify-center">
                <Music className="w-4 h-4 text-[#0a84ff]" />
              </div>
              <div>
                <p className="text-white text-sm">{file?.name || "Audio File"}</p>
                <p className="text-[rgba(255,255,255,0.35)] text-xs">
                  {formatTime(duration)} &middot; 48.0 kHz &middot; Stereo
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[#0a84ff] text-lg tabular-nums">-11.0 <span className="text-xs text-[rgba(255,255,255,0.4)]">LUFS</span></p>
              <p className="text-[rgba(255,255,255,0.35)] text-xs">-0.9 dBTP</p>
            </div>
          </div>

          {/* Waveform */}
          <WaveformDisplay
            audioData={waveformData}
            currentTime={currentTime}
            duration={duration}
            onSeek={(t) => setCurrentTime(t)}
          />

          {/* Transport */}
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={() => setCurrentTime(0)}
              className="w-10 h-10 rounded-full bg-[rgba(255,255,255,0.06)] flex items-center justify-center hover:bg-[rgba(255,255,255,0.1)] transition-colors"
              aria-label="Skip to beginning"
            >
              <SkipBack className="w-4 h-4 text-[rgba(255,255,255,0.7)]" />
            </button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setIsPlaying(!isPlaying)}
              className="w-12 h-12 rounded-full bg-gradient-to-b from-[#0a84ff] to-[#0066cc] flex items-center justify-center shadow-[0_2px_20px_rgba(10,132,255,0.35)]"
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? (
                <Pause className="w-5 h-5 text-white" />
              ) : (
                <Play className="w-5 h-5 text-white ml-0.5" />
              )}
            </motion.button>
            <div className="text-[rgba(255,255,255,0.5)] text-xs tabular-nums min-w-[80px] text-center">
              {formatTime(currentTime)} / {formatTime(duration)}
            </div>
          </div>

          {/* Spectrum */}
          <SpectrumDisplay data={spectrumData} />

          {/* Export */}
          <ExportPanel />

          {/* Mobile controls toggle */}
          <div className="lg:hidden">
            <details className="group">
              <summary className="cursor-pointer text-[#0a84ff] text-sm py-2 list-none flex items-center gap-1">
                <span>Show {mode === "simple" ? "Simple" : "Advanced"} Controls</span>
              </summary>
              <div className="pt-2">
                {mode === "simple" ? (
                  <SimpleMastering
                    intensity={intensity}
                    onIntensityChange={setIntensity}
                    genre={genre}
                    onGenreChange={setGenre}
                    toggles={toggles}
                    onToggle={(key) =>
                      setToggles((t) => ({ ...t, [key]: !t[key] }))
                    }
                    onAutoMaster={() => setIntensity(65)}
                  />
                ) : (
                  <AdvancedMastering
                    params={advParams}
                    onParamChange={(k, v) =>
                      setAdvParams((p) => ({ ...p, [k]: v }))
                    }
                    dynamics={dynamics}
                    onDynamicsToggle={(k) =>
                      setDynamics((d) => ({ ...d, [k]: !d[k] }))
                    }
                    tonePreset={tonePreset}
                    onTonePresetChange={setTonePreset}
                    outputPreset={outputPreset}
                    onOutputPresetChange={setOutputPreset}
                  />
                )}
              </div>
            </details>
          </div>
        </main>

        {/* Right Panel - Meters */}
        <aside className="w-64 border-l border-[rgba(255,255,255,0.06)] overflow-y-auto bg-[rgba(255,255,255,0.02)] p-4 shrink-0 hidden xl:block">
          <LevelMeter
            leftLevel={levels.left}
            rightLevel={levels.right}
            lufs={-11.0}
            truePeak={-0.9}
            dynamicRange={10.1}
            target={-14.0}
          />
        </aside>
      </div>
    </div>
  );
}
