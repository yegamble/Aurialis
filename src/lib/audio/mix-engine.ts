/**
 * MixEngine — manages multiple audio stems with per-stem channel strips
 * and a summing bus. Output feeds the existing ProcessingChain for a
 * master-bus stage before reaching the destination.
 *
 * Per-stem graph:
 * Source → Volume → Pan → EQ(×5) → Compressor → Makeup → Saturation → ChannelGain
 * All channels → SummingBus → ProcessingChain → MasterGain → output
 */

import type { StemTrack, StemChannelParams } from "@/types/mixer";
import { ProcessingChain } from "./chain";
import type { AudioParams } from "@/types/mastering";
import { DEFAULT_PARAMS } from "./presets";

type EventCallback = (data?: unknown) => void;
type MixEngineEvent = "statechange" | "timeupdate" | "ended";

interface StemChannel {
  id: string;
  buffer: AudioBuffer;
  source: AudioBufferSourceNode | null;
  volumeGain: GainNode;
  panner: StereoPannerNode;
  eqBands: BiquadFilterNode[];
  compressor: DynamicsCompressorNode;
  makeupGain: GainNode;
  saturation: WaveShaperNode;
  channelGain: GainNode; // final output of this channel (used for mute)
  offset: number;
  duration: number;
  muted: boolean;
  soloed: boolean;
}

function makeSaturationCurve(drive: number): Float32Array {
  const samples = 8192;
  const curve = new Float32Array(samples);
  const factor = 1 + (drive / 100) * 4; // 1x to 5x drive
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = Math.tanh(x * factor);
  }
  return curve;
}

function getSaturationCurve(drive: number): Float32Array | null {
  return drive > 0 ? makeSaturationCurve(drive) : null;
}

export class MixEngine {
  private _ctx: AudioContext | null = null;
  private _summingBus: GainNode | null = null;
  private _masterChain: ProcessingChain | null = null;
  private _masterGain: GainNode | null = null;
  private _channels = new Map<string, StemChannel>();
  private _isPlaying = false;
  private _startTime = 0;
  private _startOffset = 0;
  private _disposed = false;
  private _listeners = new Map<MixEngineEvent, Set<EventCallback>>();
  private _rafId: number | null = null;

  get isPlaying(): boolean {
    return this._isPlaying;
  }

  get isInitialized(): boolean {
    return this._ctx !== null && !this._disposed;
  }

  get isDisposed(): boolean {
    return this._disposed;
  }

  get duration(): number {
    if (this._channels.size === 0) return 0;
    let max = 0;
    for (const ch of this._channels.values()) {
      const end = ch.duration + ch.offset;
      if (end > max) max = end;
    }
    return max;
  }

  get stemCount(): number {
    return this._channels.size;
  }

  get output(): AudioNode | null {
    return this._masterGain;
  }

  get ctx(): AudioContext | null {
    return this._ctx;
  }

  getCurrentTime(): number {
    if (!this._ctx) return this._startOffset;
    if (this._isPlaying) {
      const elapsed = this._ctx.currentTime - this._startTime;
      return Math.min(this._startOffset + elapsed, this.duration);
    }
    return this._startOffset;
  }

  async init(): Promise<void> {
    if (this._disposed) return;
    if (this._ctx) return;

    this._ctx = new AudioContext({ latencyHint: "playback" });
    this._summingBus = this._ctx.createGain();
    this._masterChain = new ProcessingChain(this._ctx);
    this._masterGain = this._ctx.createGain();
    await this._masterChain.init();
    this._summingBus.connect(this._masterChain.input);
    this._masterChain.output.connect(this._masterGain);
    this._masterGain.connect(this._ctx.destination);
    this.applyMasterParams(DEFAULT_PARAMS);
  }

  /**
   * Adds a stem to the mix graph.
   *
   * NOTE (P3): the per-stem 5-band EQ built below still uses native
   * BiquadFilterNode (80/250/1k/4k/12k fixed). The mastering bus was
   * upgraded to a parametric EQ (see `docs/plans/2026-04-23-parametric-eq.md`);
   * unifying the per-stem EQ with the new ParametricEqDSP is intentionally
   * deferred to a future plan.
   */
  addStem(stem: StemTrack): void {
    if (!this._ctx || !this._summingBus || !stem.audioBuffer) return;

    const ctx = this._ctx;

    // Volume
    const volumeGain = ctx.createGain();
    volumeGain.gain.value = Math.pow(10, stem.channelParams.volume / 20);

    // Pan
    const panner = ctx.createStereoPanner();
    panner.pan.value = stem.channelParams.pan;

    // 5-band EQ
    const eqTypes: BiquadFilterType[] = [
      "lowshelf", "peaking", "peaking", "peaking", "highshelf",
    ];
    const eqFreqs = [80, 250, 1000, 4000, 12000];
    const eqBands = eqTypes.map((type, i) => {
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = eqFreqs[i];
      filter.gain.value = stem.channelParams.eq[i];
      if (type === "peaking") filter.Q.value = 1;
      return filter;
    });

    // Compressor (built-in DynamicsCompressorNode)
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = stem.channelParams.compThreshold;
    compressor.ratio.value = stem.channelParams.compRatio;
    compressor.attack.value = stem.channelParams.compAttack / 1000; // ms→s
    compressor.release.value = stem.channelParams.compRelease / 1000;

    // Compressor makeup gain
    const makeupGain = ctx.createGain();
    makeupGain.gain.value = Math.pow(10, stem.channelParams.compMakeup / 20);

    // Saturation (WaveShaperNode)
    const saturation = ctx.createWaveShaper();
    saturation.curve = getSaturationCurve(stem.channelParams.satDrive);
    saturation.oversample = "4x";

    // Channel output gain (used for mute)
    const channelGain = ctx.createGain();

    // Wire: volume → pan → eq0 → eq1 → ... → eq4 → compressor → makeup → saturation → channelGain → summingBus
    volumeGain.connect(panner);
    panner.connect(eqBands[0]);
    for (let i = 0; i < eqBands.length - 1; i++) {
      eqBands[i].connect(eqBands[i + 1]);
    }
    eqBands[eqBands.length - 1].connect(compressor);
    compressor.connect(makeupGain);
    makeupGain.connect(saturation);
    saturation.connect(channelGain);
    channelGain.connect(this._summingBus);

    this._channels.set(stem.id, {
      id: stem.id,
      buffer: stem.audioBuffer,
      source: null,
      volumeGain,
      panner,
      eqBands,
      compressor,
      makeupGain,
      saturation,
      channelGain,
      offset: stem.offset,
      duration: stem.duration,
      muted: stem.channelParams.mute,
      soloed: stem.channelParams.solo,
    });

    this._updateMuteState();
  }

  removeStem(id: string): void {
    const ch = this._channels.get(id);
    if (!ch) return;

    this._destroySource(ch);
    ch.volumeGain.disconnect();
    ch.panner.disconnect();
    for (const band of ch.eqBands) band.disconnect();
    ch.compressor.disconnect();
    ch.makeupGain.disconnect();
    ch.saturation.disconnect();
    ch.channelGain.disconnect();

    this._channels.delete(id);
    this._updateMuteState();
  }

  async play(): Promise<void> {
    if (!this._ctx || this._channels.size === 0) return;
    if (this._isPlaying) return;

    if (this._ctx.state === "suspended") {
      await this._ctx.resume();
    }

    const now = this._ctx.currentTime;

    for (const ch of this._channels.values()) {
      const source = this._ctx.createBufferSource();
      source.buffer = ch.buffer;
      source.connect(ch.volumeGain);

      // Start time: base time + stem offset, adjusted for current seek position
      const stemStartDelay = Math.max(0, ch.offset - this._startOffset);
      const bufferOffset = Math.max(0, this._startOffset - ch.offset);

      if (bufferOffset < ch.duration) {
        source.start(now + stemStartDelay, bufferOffset);
      }

      ch.source = source;
    }

    this._startTime = now;
    this._isPlaying = true;
    this._startRaf();
    this._emit("statechange", { isPlaying: true });
  }

  pause(): void {
    if (!this._isPlaying || !this._ctx) return;

    this._startOffset = this.getCurrentTime();
    this._destroyAllSources();
    this._isPlaying = false;
    this._stopRaf();
    this._emit("statechange", { isPlaying: false });
  }

  stop(): void {
    if (!this._ctx) return;

    this._destroyAllSources();
    this._isPlaying = false;
    this._startOffset = 0;
    this._stopRaf();
    this._emit("statechange", { isPlaying: false });
    this._emit("timeupdate", 0);
  }

  seek(time: number): void {
    const clamped = Math.max(0, Math.min(time, this.duration));
    const wasPlaying = this._isPlaying;

    if (wasPlaying) {
      this._destroyAllSources();
      this._isPlaying = false;
    }

    this._startOffset = clamped;
    this._emit("timeupdate", clamped);

    if (wasPlaying) {
      this.play();
    }
  }

  // --- Channel strip parameter updates ---

  updateStemVolume(stemId: string, dB: number): void {
    const ch = this._channels.get(stemId);
    if (!ch || !this._ctx) return;
    ch.volumeGain.gain.linearRampToValueAtTime(
      Math.pow(10, dB / 20),
      this._ctx.currentTime + 0.01
    );
  }

  updateStemPan(stemId: string, pan: number): void {
    const ch = this._channels.get(stemId);
    if (!ch || !this._ctx) return;
    ch.panner.pan.linearRampToValueAtTime(
      Math.max(-1, Math.min(1, pan)),
      this._ctx.currentTime + 0.01
    );
  }

  updateStemEQ(stemId: string, bandIndex: number, dB: number): void {
    const ch = this._channels.get(stemId);
    if (!ch || bandIndex < 0 || bandIndex >= 5) return;
    ch.eqBands[bandIndex].gain.value = Math.max(-12, Math.min(12, dB));
  }

  updateStemCompressor(
    stemId: string,
    params: {
      threshold?: number;
      ratio?: number;
      attack?: number;
      release?: number;
      makeup?: number;
    }
  ): void {
    const ch = this._channels.get(stemId);
    if (!ch) return;
    if (params.threshold !== undefined)
      ch.compressor.threshold.value = params.threshold;
    if (params.ratio !== undefined) ch.compressor.ratio.value = params.ratio;
    if (params.attack !== undefined)
      ch.compressor.attack.value = params.attack / 1000;
    if (params.release !== undefined)
      ch.compressor.release.value = params.release / 1000;
    if (params.makeup !== undefined)
      ch.makeupGain.gain.value = Math.pow(10, params.makeup / 20);
  }

  updateStemSaturation(stemId: string, drive: number): void {
    const ch = this._channels.get(stemId);
    if (!ch) return;
    ch.saturation.curve = getSaturationCurve(drive);
  }

  applyChannelParams(stemId: string, params: StemChannelParams): void {
    this.updateStemVolume(stemId, params.volume);
    this.updateStemPan(stemId, params.pan);
    for (let i = 0; i < 5; i++) {
      this.updateStemEQ(stemId, i, params.eq[i]);
    }
    this.updateStemCompressor(stemId, {
      threshold: params.compThreshold,
      ratio: params.compRatio,
      attack: params.compAttack,
      release: params.compRelease,
      makeup: params.compMakeup,
    });
    this.updateStemSaturation(stemId, params.satDrive);
    this.setMute(stemId, params.mute);
    this.setSolo(stemId, params.solo);
  }

  applyMasterParams(params: AudioParams): void {
    this._masterChain?.updateParam("threshold", params.threshold);
    this._masterChain?.updateParam("ratio", params.ratio);
    this._masterChain?.updateParam("attack", params.attack);
    this._masterChain?.updateParam("release", params.release);
    this._masterChain?.updateParam("makeup", params.makeup);
    this._masterChain?.updateParam("eq80", params.eq80);
    this._masterChain?.updateParam("eq250", params.eq250);
    this._masterChain?.updateParam("eq1k", params.eq1k);
    this._masterChain?.updateParam("eq4k", params.eq4k);
    this._masterChain?.updateParam("eq12k", params.eq12k);
    // Parametric EQ (P3) — master bypass + 5 bands × 6 fields each.
    // NOTE: addStem() has its own per-stem 5-band BiquadFilter EQ chain; that
    // one is intentionally NOT upgraded in this plan
    // (see docs/plans/2026-04-23-parametric-eq.md — out of scope).
    this._masterChain?.updateParam("parametricEqEnabled", params.parametricEqEnabled);
    this._masterChain?.updateParam("eqBand1Enabled", params.eqBand1Enabled);
    this._masterChain?.updateParam("eqBand1Freq", params.eqBand1Freq);
    this._masterChain?.updateParam("eqBand1Q", params.eqBand1Q);
    this._masterChain?.updateParam("eqBand1Type", params.eqBand1Type);
    this._masterChain?.updateParam("eqBand1Mode", params.eqBand1Mode);
    this._masterChain?.updateParam("eqBand1MsBalance", params.eqBand1MsBalance);
    this._masterChain?.updateParam("eqBand2Enabled", params.eqBand2Enabled);
    this._masterChain?.updateParam("eqBand2Freq", params.eqBand2Freq);
    this._masterChain?.updateParam("eqBand2Q", params.eqBand2Q);
    this._masterChain?.updateParam("eqBand2Type", params.eqBand2Type);
    this._masterChain?.updateParam("eqBand2Mode", params.eqBand2Mode);
    this._masterChain?.updateParam("eqBand2MsBalance", params.eqBand2MsBalance);
    this._masterChain?.updateParam("eqBand3Enabled", params.eqBand3Enabled);
    this._masterChain?.updateParam("eqBand3Freq", params.eqBand3Freq);
    this._masterChain?.updateParam("eqBand3Q", params.eqBand3Q);
    this._masterChain?.updateParam("eqBand3Type", params.eqBand3Type);
    this._masterChain?.updateParam("eqBand3Mode", params.eqBand3Mode);
    this._masterChain?.updateParam("eqBand3MsBalance", params.eqBand3MsBalance);
    this._masterChain?.updateParam("eqBand4Enabled", params.eqBand4Enabled);
    this._masterChain?.updateParam("eqBand4Freq", params.eqBand4Freq);
    this._masterChain?.updateParam("eqBand4Q", params.eqBand4Q);
    this._masterChain?.updateParam("eqBand4Type", params.eqBand4Type);
    this._masterChain?.updateParam("eqBand4Mode", params.eqBand4Mode);
    this._masterChain?.updateParam("eqBand4MsBalance", params.eqBand4MsBalance);
    this._masterChain?.updateParam("eqBand5Enabled", params.eqBand5Enabled);
    this._masterChain?.updateParam("eqBand5Freq", params.eqBand5Freq);
    this._masterChain?.updateParam("eqBand5Q", params.eqBand5Q);
    this._masterChain?.updateParam("eqBand5Type", params.eqBand5Type);
    this._masterChain?.updateParam("eqBand5Mode", params.eqBand5Mode);
    this._masterChain?.updateParam("eqBand5MsBalance", params.eqBand5MsBalance);
    this._masterChain?.updateParam("satDrive", params.satDrive);
    this._masterChain?.updateParam("stereoWidth", params.stereoWidth);
    this._masterChain?.updateParam("bassMonoFreq", params.bassMonoFreq);
    this._masterChain?.updateParam("midGain", params.midGain);
    this._masterChain?.updateParam("sideGain", params.sideGain);
    this._masterChain?.updateParam("ceiling", params.ceiling);
    this._masterChain?.updateParam("limiterRelease", params.limiterRelease);
  }

  // --- Mute/Solo ---

  setMute(stemId: string, muted: boolean): void {
    const ch = this._channels.get(stemId);
    if (!ch) return;
    ch.muted = muted;
    this._updateMuteState();
  }

  setSolo(stemId: string, soloed: boolean): void {
    const ch = this._channels.get(stemId);
    if (!ch) return;
    ch.soloed = soloed;
    this._updateMuteState();
  }

  isMuted(stemId: string): boolean {
    return this._channels.get(stemId)?.muted ?? false;
  }

  isSoloed(stemId: string): boolean {
    return this._channels.get(stemId)?.soloed ?? false;
  }

  isEffectivelyMuted(stemId: string): boolean {
    const ch = this._channels.get(stemId);
    if (!ch) return true;

    // If any stem is soloed, only soloed stems are audible
    const anySoloed = [...this._channels.values()].some((c) => c.soloed);
    if (anySoloed) return !ch.soloed;

    return ch.muted;
  }

  // --- Time offset ---

  setStemOffset(stemId: string, offset: number): void {
    const ch = this._channels.get(stemId);
    if (!ch) return;
    ch.offset = Math.max(0, offset);
  }

  getStemOffset(stemId: string): number {
    return this._channels.get(stemId)?.offset ?? 0;
  }

  // --- Master volume ---

  setMasterVolume(dB: number): void {
    if (!this._masterGain || !this._ctx) return;
    this._masterGain.gain.linearRampToValueAtTime(
      Math.pow(10, dB / 20),
      this._ctx.currentTime + 0.01
    );
  }

  // --- Events ---

  on(event: MixEngineEvent, callback: EventCallback): void {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event)!.add(callback);
  }

  off(event: MixEngineEvent, callback: EventCallback): void {
    this._listeners.get(event)?.delete(callback);
  }

  // --- Lifecycle ---

  async dispose(): Promise<void> {
    if (this._disposed) return;
    this._disposed = true;

    this.stop();

    for (const ch of this._channels.values()) {
      ch.volumeGain.disconnect();
      ch.panner.disconnect();
      for (const band of ch.eqBands) band.disconnect();
      ch.compressor.disconnect();
      ch.makeupGain.disconnect();
      ch.saturation.disconnect();
      ch.channelGain.disconnect();
    }
    this._channels.clear();

    this._summingBus?.disconnect();
    this._masterChain?.dispose();
    this._masterGain?.disconnect();

    if (this._ctx && this._ctx.state !== "closed") {
      await this._ctx.close();
    }

    this._ctx = null;
    this._summingBus = null;
    this._masterChain = null;
    this._masterGain = null;
    this._listeners.clear();
  }

  // --- Private ---

  private _updateMuteState(): void {
    const anySoloed = [...this._channels.values()].some((c) => c.soloed);

    for (const ch of this._channels.values()) {
      let shouldMute: boolean;
      if (anySoloed) {
        shouldMute = !ch.soloed;
      } else {
        shouldMute = ch.muted;
      }
      ch.channelGain.gain.value = shouldMute ? 0 : 1;
    }
  }

  private _destroySource(ch: StemChannel): void {
    if (ch.source) {
      try {
        ch.source.stop();
      } catch {
        // Already stopped
      }
      ch.source.disconnect();
      ch.source = null;
    }
  }

  private _destroyAllSources(): void {
    for (const ch of this._channels.values()) {
      this._destroySource(ch);
    }
  }

  private _emit(event: MixEngineEvent, data?: unknown): void {
    this._listeners.get(event)?.forEach((cb) => cb(data));
  }

  private _startRaf(): void {
    this._stopRaf();
    const tick = () => {
      if (!this._isPlaying) return;
      this._emit("timeupdate", this.getCurrentTime());
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  private _stopRaf(): void {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }
}
