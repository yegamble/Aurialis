/**
 * ProcessingChain — builds and connects the full DSP signal chain:
 * InputGain → EQ → Compressor → Saturation → StereoWidth → Limiter → Metering → Destination
 *
 * Callers connect their source to chain.input and chain.output to the analyser/destination.
 */

import { EQNode } from "./nodes/eq";
import { StereoWidthNode } from "./nodes/stereo-width";
import { CompressorNode } from "./nodes/compressor";
import {
  MultibandCompressorNode,
  type BandName,
  type MultibandGainReduction,
} from "./nodes/multiband-compressor";
import { LimiterNode } from "./nodes/limiter";
import { SaturationNode } from "./nodes/saturation";
import { MeteringNode, type MeteringMessage } from "./nodes/metering";
import type { AudioParams } from "@/lib/stores/audio-store";
import type { EqBandMode, EqBandType, MultibandMode, SaturationMode } from "@/types/mastering";

export class ProcessingChain {
  private readonly _ctx: AudioContext;
  private _inputGain: GainNode | null = null;
  private _outputGain: GainNode | null = null;
  private _eq: EQNode | null = null;
  private _compressor: CompressorNode | null = null;
  private _multiband: MultibandCompressorNode | null = null;
  private _saturation: SaturationNode | null = null;
  private _stereoWidth: StereoWidthNode | null = null;
  private _limiter: LimiterNode | null = null;
  private _metering: MeteringNode | null = null;
  private _processingAvailable = false;

  // Phase 4a Task 6: L/R AnalyserNodes tapped off the end of the chain for
  // the goniometer visual. NOT routed through metering-processor.js — the
  // goniometer reads time-domain data on the main thread, keeping the
  // BS.1770-4 metering worklet untouched.
  private _goniometerSplitter: ChannelSplitterNode | null = null;
  private _leftAnalyser: AnalyserNode | null = null;
  private _rightAnalyser: AnalyserNode | null = null;

  onMetering: ((data: MeteringMessage) => void) | null = null;
  onMultibandGR: ((gr: MultibandGainReduction) => void) | null = null;

  constructor(ctx: AudioContext) {
    this._ctx = ctx;
  }

  get processingAvailable(): boolean {
    return this._processingAvailable;
  }

  get input(): AudioNode {
    if (!this._inputGain) throw new Error("ProcessingChain: call init() first");
    return this._inputGain;
  }

  get output(): AudioNode {
    if (!this._outputGain) throw new Error("ProcessingChain: call init() first");
    return this._outputGain;
  }

  /** Left-channel analyser for the goniometer visual (null until init()). */
  get leftAnalyser(): AnalyserNode | null {
    return this._leftAnalyser;
  }

  /** Right-channel analyser for the goniometer visual (null until init()). */
  get rightAnalyser(): AnalyserNode | null {
    return this._rightAnalyser;
  }

  async init(): Promise<void> {
    this._inputGain = this._ctx.createGain();
    this._outputGain = this._ctx.createGain();

    // Try loading all worklets — fall back to bypass if any fail
    try {
      this._compressor = new CompressorNode(this._ctx);
      this._multiband = new MultibandCompressorNode(this._ctx);
      this._limiter = new LimiterNode(this._ctx);
      this._saturation = new SaturationNode(this._ctx);
      this._metering = new MeteringNode(this._ctx);
      this._eq = new EQNode(this._ctx);

      await Promise.all([
        this._compressor.init(),
        this._multiband.init(),
        this._limiter.init(),
        this._saturation.init(),
        this._metering.init(),
        this._eq.init(),
      ]);

      // Wire metering callback
      this._metering.onMetering = (data) => {
        if (this.onMetering) this.onMetering(data);
      };
      this._multiband.onGainReduction = (gr) => {
        if (this.onMultibandGR) this.onMultibandGR(gr);
      };

      this._stereoWidth = new StereoWidthNode(this._ctx);

      // Chain: inputGain → EQ → Compressor → MultibandCompressor → Saturation → StereoWidth → Limiter → Metering → outputGain
      this._inputGain.connect(this._eq.input);
      this._eq.output.connect(this._compressor.input);
      this._compressor.output.connect(this._multiband.input);
      this._multiband.output.connect(this._saturation.input);
      this._saturation.output.connect(this._stereoWidth.input);
      this._stereoWidth.output.connect(this._limiter.input);
      this._limiter.output.connect(this._metering.input);
      this._metering.output.connect(this._outputGain);

      // Goniometer analyser taps — post-metering, pre-outputGain. Channel
      // splitter sends L→leftAnalyser, R→rightAnalyser. Tests on happy-dom
      // may not have createChannelSplitter / createAnalyser; guard defensively.
      // Nested try/catch: a goniometer-init failure must NOT cascade to the
      // outer catch (which would fall back to full chain bypass). Goniometer
      // failure degrades to 'no goniometer', not 'no DSP'.
      try {
        const ctx = this._ctx as AudioContext & {
          createChannelSplitter?: AudioContext["createChannelSplitter"];
          createAnalyser?: AudioContext["createAnalyser"];
        };
        if (
          typeof ctx.createChannelSplitter === "function" &&
          typeof ctx.createAnalyser === "function"
        ) {
          this._goniometerSplitter = ctx.createChannelSplitter(2);
          this._leftAnalyser = ctx.createAnalyser();
          this._rightAnalyser = ctx.createAnalyser();
          this._leftAnalyser.fftSize = 2048;
          this._rightAnalyser.fftSize = 2048;
          this._leftAnalyser.smoothingTimeConstant = 0;
          this._rightAnalyser.smoothingTimeConstant = 0;
          this._metering.output.connect(this._goniometerSplitter);
          this._goniometerSplitter.connect(this._leftAnalyser, 0);
          this._goniometerSplitter.connect(this._rightAnalyser, 1);
        }
      } catch {
        // Goniometer init failed — leave analysers null. The main DSP chain
        // is already wired and must stay available.
        this._goniometerSplitter = null;
        this._leftAnalyser = null;
        this._rightAnalyser = null;
      }

      this._processingAvailable = true;
    } catch {
      // Worklets failed — bypass mode: direct passthrough
      this._processingAvailable = false;
      this._inputGain.connect(this._outputGain);
    }
  }

  /**
   * Route a parameter change to the appropriate DSP node.
   * `AudioParams` is mostly numeric; the `satMode` field is a string enum.
   */
  updateParam<K extends keyof AudioParams>(key: K, value: AudioParams[K]): void {
    if (!this._processingAvailable) return;

    // Numeric cases — cast once since the case narrows the key but not the generic value type
    const n = value as number;
    switch (key) {
      // EQ bands
      case "eq80":
        this._eq?.setGain(0, n);
        break;
      case "eq250":
        this._eq?.setGain(1, n);
        break;
      case "eq1k":
        this._eq?.setGain(2, n);
        break;
      case "eq4k":
        this._eq?.setGain(3, n);
        break;
      case "eq12k":
        this._eq?.setGain(4, n);
        break;

      // Parametric EQ master bypass
      case "parametricEqEnabled":
        this._eq?.setEnabled(n);
        break;

      // Parametric EQ Band 1
      case "eqBand1Enabled":
        this._eq?.setBandEnabled(0, n);
        break;
      case "eqBand1Freq":
        this._eq?.setBandFreq(0, n);
        break;
      case "eqBand1Q":
        this._eq?.setBandQ(0, n);
        break;
      case "eqBand1Type":
        this._eq?.setBandType(0, value as EqBandType);
        break;
      case "eqBand1Mode":
        this._eq?.setBandMode(0, value as EqBandMode);
        break;
      case "eqBand1MsBalance":
        this._eq?.setBandMsBalance(0, n);
        break;

      // Parametric EQ Band 2
      case "eqBand2Enabled":
        this._eq?.setBandEnabled(1, n);
        break;
      case "eqBand2Freq":
        this._eq?.setBandFreq(1, n);
        break;
      case "eqBand2Q":
        this._eq?.setBandQ(1, n);
        break;
      case "eqBand2Type":
        this._eq?.setBandType(1, value as EqBandType);
        break;
      case "eqBand2Mode":
        this._eq?.setBandMode(1, value as EqBandMode);
        break;
      case "eqBand2MsBalance":
        this._eq?.setBandMsBalance(1, n);
        break;

      // Parametric EQ Band 3
      case "eqBand3Enabled":
        this._eq?.setBandEnabled(2, n);
        break;
      case "eqBand3Freq":
        this._eq?.setBandFreq(2, n);
        break;
      case "eqBand3Q":
        this._eq?.setBandQ(2, n);
        break;
      case "eqBand3Type":
        this._eq?.setBandType(2, value as EqBandType);
        break;
      case "eqBand3Mode":
        this._eq?.setBandMode(2, value as EqBandMode);
        break;
      case "eqBand3MsBalance":
        this._eq?.setBandMsBalance(2, n);
        break;

      // Parametric EQ Band 4
      case "eqBand4Enabled":
        this._eq?.setBandEnabled(3, n);
        break;
      case "eqBand4Freq":
        this._eq?.setBandFreq(3, n);
        break;
      case "eqBand4Q":
        this._eq?.setBandQ(3, n);
        break;
      case "eqBand4Type":
        this._eq?.setBandType(3, value as EqBandType);
        break;
      case "eqBand4Mode":
        this._eq?.setBandMode(3, value as EqBandMode);
        break;
      case "eqBand4MsBalance":
        this._eq?.setBandMsBalance(3, n);
        break;

      // Parametric EQ Band 5
      case "eqBand5Enabled":
        this._eq?.setBandEnabled(4, n);
        break;
      case "eqBand5Freq":
        this._eq?.setBandFreq(4, n);
        break;
      case "eqBand5Q":
        this._eq?.setBandQ(4, n);
        break;
      case "eqBand5Type":
        this._eq?.setBandType(4, value as EqBandType);
        break;
      case "eqBand5Mode":
        this._eq?.setBandMode(4, value as EqBandMode);
        break;
      case "eqBand5MsBalance":
        this._eq?.setBandMsBalance(4, n);
        break;

      // Per-stage master enables (Phase 4a Task 4) — forward to each node's
      // existing setBypass() method. Global A/B (engine.setBypass) is a
      // separate path; per-stage state persists across global toggles.
      case "compressorEnabled":
        this._compressor?.setBypass(n === 0);
        break;
      case "saturationEnabled":
        this._saturation?.setBypass(n === 0);
        break;
      case "stereoWidthEnabled":
        this._stereoWidth?.setBypass(n === 0);
        break;
      case "limiterEnabled":
        this._limiter?.setBypass(n === 0);
        break;

      // Compressor
      case "threshold":
        this._compressor?.setThreshold(n);
        break;
      case "ratio":
        this._compressor?.setRatio(n);
        break;
      case "attack":
        this._compressor?.setAttack(n);
        break;
      case "release":
        this._compressor?.setRelease(n);
        break;
      case "makeup":
        this._compressor?.setMakeup(n);
        break;
      case "sidechainHpfHz":
        this._compressor?.setSidechainHpfHz(n);
        break;
      case "autoRelease":
        this._compressor?.setAutoRelease(n);
        break;

      // Saturation
      case "satDrive":
        this._saturation?.setDrive(n);
        break;
      case "satMode":
        this._saturation?.setSatMode(value as SaturationMode);
        break;

      // Stereo width
      case "stereoWidth":
        this._stereoWidth?.setWidth(n);
        break;
      case "bassMonoFreq":
        this._stereoWidth?.setBassMonoFreq(n);
        break;
      case "midGain":
        this._stereoWidth?.setMidGain(n);
        break;
      case "sideGain":
        this._stereoWidth?.setSideGain(n);
        break;

      // Limiter
      case "ceiling":
        this._limiter?.setCeiling(n);
        break;
      case "limiterRelease":
        this._limiter?.setRelease(n);
        break;

      // Multiband (master + crossovers)
      case "multibandEnabled":
        this._multiband?.setEnabled(n);
        break;
      case "mbCrossLowMid":
        this._multiband?.setCrossLowMid(n);
        break;
      case "mbCrossMidHigh":
        this._multiband?.setCrossMidHigh(n);
        break;

      // Multiband — Low
      case "mbLowEnabled":
        this._multiband?.setBandEnabled("low", n);
        break;
      case "mbLowSolo":
        this._multiband?.setBandSolo("low", n);
        break;
      case "mbLowThreshold":
        this._multiband?.setBandThreshold("low", n);
        break;
      case "mbLowRatio":
        this._multiband?.setBandRatio("low", n);
        break;
      case "mbLowAttack":
        this._multiband?.setBandAttack("low", n);
        break;
      case "mbLowRelease":
        this._multiband?.setBandRelease("low", n);
        break;
      case "mbLowMakeup":
        this._multiband?.setBandMakeup("low", n);
        break;
      case "mbLowMode":
        this._multiband?.setBandMode("low", value as MultibandMode);
        break;
      case "mbLowMsBalance":
        this._multiband?.setBandMsBalance("low", n);
        break;

      // Multiband — Mid
      case "mbMidEnabled":
        this._multiband?.setBandEnabled("mid", n);
        break;
      case "mbMidSolo":
        this._multiband?.setBandSolo("mid", n);
        break;
      case "mbMidThreshold":
        this._multiband?.setBandThreshold("mid", n);
        break;
      case "mbMidRatio":
        this._multiband?.setBandRatio("mid", n);
        break;
      case "mbMidAttack":
        this._multiband?.setBandAttack("mid", n);
        break;
      case "mbMidRelease":
        this._multiband?.setBandRelease("mid", n);
        break;
      case "mbMidMakeup":
        this._multiband?.setBandMakeup("mid", n);
        break;
      case "mbMidMode":
        this._multiband?.setBandMode("mid", value as MultibandMode);
        break;
      case "mbMidMsBalance":
        this._multiband?.setBandMsBalance("mid", n);
        break;

      // Multiband — High
      case "mbHighEnabled":
        this._multiband?.setBandEnabled("high", n);
        break;
      case "mbHighSolo":
        this._multiband?.setBandSolo("high", n);
        break;
      case "mbHighThreshold":
        this._multiband?.setBandThreshold("high", n);
        break;
      case "mbHighRatio":
        this._multiband?.setBandRatio("high", n);
        break;
      case "mbHighAttack":
        this._multiband?.setBandAttack("high", n);
        break;
      case "mbHighRelease":
        this._multiband?.setBandRelease("high", n);
        break;
      case "mbHighMakeup":
        this._multiband?.setBandMakeup("high", n);
        break;
      case "mbHighMode":
        this._multiband?.setBandMode("high", value as MultibandMode);
        break;
      case "mbHighMsBalance":
        this._multiband?.setBandMsBalance("high", n);
        break;
    }
  }

  dispose(): void {
    this._inputGain?.disconnect();
    this._eq?.dispose();
    this._compressor?.dispose();
    this._multiband?.dispose();
    this._saturation?.dispose();
    this._stereoWidth?.dispose();
    this._limiter?.dispose();
    this._metering?.dispose();
    this._goniometerSplitter?.disconnect();
    this._leftAnalyser?.disconnect();
    this._rightAnalyser?.disconnect();
    this._outputGain?.disconnect();
  }
}
