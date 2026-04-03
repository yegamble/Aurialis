import type { AudioEngineEventType, MeteringData } from "@/types/audio";
import { loadAudioFile } from "./loader";
import { ProcessingChain } from "./chain";
import { AudioBypass } from "./bypass";
import type { AudioParams } from "@/lib/stores/audio-store";

type EventCallback = (data?: unknown) => void;

export class AudioEngine {
  private context: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private inputGain: GainNode | null = null;
  private outputGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private chain: ProcessingChain | null = null;

  private _bypass: AudioBypass | null = null;
  private _isPlaying = false;
  private _startTime = 0;
  private _startOffset = 0;
  private _duration = 0;
  private _disposed = false;

  private listeners = new Map<AudioEngineEventType, Set<EventCallback>>();
  private rafId: number | null = null;

  get isPlaying(): boolean {
    return this._isPlaying;
  }

  get duration(): number {
    return this._duration;
  }

  get isLoaded(): boolean {
    return this.buffer !== null;
  }

  get sampleRate(): number {
    return this.context?.sampleRate ?? 44100;
  }

  get audioBuffer(): AudioBuffer | null {
    return this.buffer;
  }

  get analyserNode(): AnalyserNode | null {
    return this.analyser;
  }

  getCurrentTime(): number {
    if (!this.context) return 0;
    if (this._isPlaying) {
      const elapsed = this.context.currentTime - this._startTime;
      const time = this._startOffset + elapsed;
      return Math.min(time, this._duration);
    }
    return this._startOffset;
  }

  async init(): Promise<void> {
    if (this._disposed) return;
    if (this.context) return;

    this.context = new AudioContext({ latencyHint: "playback" });

    this.inputGain = this.context.createGain();
    this.outputGain = this.context.createGain();
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.8;

    // Build processing chain (loads worklets, falls back to bypass on failure)
    this.chain = new ProcessingChain(this.context);
    await this.chain.init();
    // Guard: engine may have been disposed during async chain.init() (React StrictMode)
    if (this._disposed || !this.chain) {
      this.context = null;
      return;
    }
    this.chain.onMetering = (data) => {
      const metering: MeteringData = {
        leftLevel: data.leftLevel,
        rightLevel: data.rightLevel,
        lufs: data.lufs,
        shortTermLufs: data.shortTermLufs,
        integratedLufs: data.integratedLufs,
        truePeak: data.truePeak,
        dynamicRange: data.dynamicRange,
      };
      this.emit("metering", metering);
    };

    // Signal chain: inputGain → [ProcessingChain] → outputGain → analyser → destination
    this.inputGain.connect(this.chain.input);
    this.chain.output.connect(this.outputGain);
    this.outputGain.connect(this.analyser);
    this.analyser.connect(this.context.destination);
  }

  /** Apply a parameter change to the processing chain */
  updateParameter(key: keyof AudioParams, value: number): void {
    this.chain?.updateParam(key, value);
  }

  /** Engage or disengage A/B bypass. When active, audio skips the processing chain. */
  setBypass(active: boolean): void {
    if (!this.inputGain || !this.chain || !this.outputGain) return;
    if (!this._bypass) {
      this._bypass = new AudioBypass(this.inputGain, this.chain, this.outputGain);
    }
    if (active) this._bypass.enable();
    else this._bypass.disable();
  }

  get isDisposed(): boolean {
    return this._disposed;
  }

  get processingAvailable(): boolean {
    return this.chain?.processingAvailable ?? false;
  }

  async loadFile(file: File): Promise<void> {
    if (!this.context) await this.init();
    if (!this.context) return;

    if (this._isPlaying) this.stop();

    const { buffer } = await loadAudioFile(file, this.context);
    this.buffer = buffer;
    this._duration = buffer.duration;
    this._startOffset = 0;

    this.emit("loaded", {
      duration: buffer.duration,
      sampleRate: buffer.sampleRate,
      channels: buffer.numberOfChannels,
    });
  }

  loadBuffer(buffer: AudioBuffer): void {
    if (this._isPlaying) this.stop();
    this.buffer = buffer;
    this._duration = buffer.duration;
    this._startOffset = 0;

    this.emit("loaded", {
      duration: buffer.duration,
      sampleRate: buffer.sampleRate,
      channels: buffer.numberOfChannels,
    });
  }

  async play(): Promise<void> {
    if (!this.context || !this.buffer || !this.inputGain) return;
    if (this._isPlaying) return;

    if (this.context.state === "suspended") {
      await this.context.resume();
    }

    // AudioBufferSourceNode cannot be restarted — create new one each play
    this.sourceNode = this.context.createBufferSource();
    this.sourceNode.buffer = this.buffer;
    this.sourceNode.connect(this.inputGain);

    this.sourceNode.onended = () => {
      if (this._isPlaying) {
        const currentTime = this.getCurrentTime();
        // Only treat as natural end if we're near the end
        if (currentTime >= this._duration - 0.05) {
          this._isPlaying = false;
          this._startOffset = 0;
          this.stopRaf();
          this.emit("ended");
          this.emit("statechange", { isPlaying: false });
        }
      }
    };

    this._startTime = this.context.currentTime;
    this.sourceNode.start(0, this._startOffset);
    this._isPlaying = true;

    this.startRaf();
    this.emit("statechange", { isPlaying: true });
  }

  pause(): void {
    if (!this._isPlaying || !this.context) return;

    this._startOffset = this.getCurrentTime();
    this.destroySource();
    this._isPlaying = false;

    this.stopRaf();
    this.emit("statechange", { isPlaying: false });
  }

  stop(): void {
    if (!this.context) return;

    this.destroySource();
    this._isPlaying = false;
    this._startOffset = 0;

    this.stopRaf();
    this.emit("statechange", { isPlaying: false });
    this.emit("timeupdate", 0);
  }

  seek(time: number): void {
    const clampedTime = Math.max(0, Math.min(time, this._duration));
    const wasPlaying = this._isPlaying;

    if (wasPlaying) {
      this.destroySource();
      this._isPlaying = false;
    }

    this._startOffset = clampedTime;
    this.emit("timeupdate", clampedTime);

    if (wasPlaying) {
      // Restart playback from new position
      this.play();
    }
  }

  setInputGain(db: number): void {
    if (!this.inputGain || !this.context) return;
    const gain = Math.pow(10, db / 20);
    this.inputGain.gain.linearRampToValueAtTime(
      gain,
      this.context.currentTime + 0.01
    );
  }

  setOutputGain(db: number): void {
    if (!this.outputGain || !this.context) return;
    const gain = Math.pow(10, db / 20);
    this.outputGain.gain.linearRampToValueAtTime(
      gain,
      this.context.currentTime + 0.01
    );
  }

  // Visualization data getters
  getFrequencyData(): Float32Array {
    if (!this.analyser) return new Float32Array(0);
    const data = new Float32Array(this.analyser.frequencyBinCount);
    this.analyser.getFloatFrequencyData(data);
    return data;
  }

  getTimeDomainData(): Float32Array {
    if (!this.analyser) return new Float32Array(0);
    const data = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(data);
    return data;
  }

  getPeakLevels(): { left: number; right: number } {
    if (!this.analyser) return { left: 0, right: 0 };
    const data = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(data);

    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      const abs = Math.abs(data[i]);
      if (abs > peak) peak = abs;
    }

    // Mono fallback — real stereo metering comes from the metering worklet via chain.onMetering
    const level = Math.min(1, peak);
    return { left: level, right: level };
  }

  on(event: AudioEngineEventType, callback: EventCallback): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off(event: AudioEngineEventType, callback: EventCallback): void {
    this.listeners.get(event)?.delete(callback);
  }

  async dispose(): Promise<void> {
    this._disposed = true;
    this.stop();
    this.stopRaf();

    this.inputGain?.disconnect();
    this.chain?.dispose();
    this.outputGain?.disconnect();
    this.analyser?.disconnect();

    if (this.context && this.context.state !== "closed") {
      await this.context.close();
    }

    this.context = null;
    this.buffer = null;
    this.inputGain = null;
    this.outputGain = null;
    this.analyser = null;
    this.chain = null;
    this._bypass = null;
    this.listeners.clear();
  }

  private destroySource(): void {
    if (this.sourceNode) {
      this.sourceNode.onended = null;
      try {
        this.sourceNode.stop();
      } catch {
        // Already stopped
      }
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
  }

  private emit(event: AudioEngineEventType, data?: unknown): void {
    this.listeners.get(event)?.forEach((cb) => cb(data));
  }

  private startRaf(): void {
    this.stopRaf();
    const tick = () => {
      if (!this._isPlaying) return;
      this.emit("timeupdate", this.getCurrentTime());
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopRaf(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}
