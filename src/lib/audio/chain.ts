/**
 * ProcessingChain — builds and connects the full DSP signal chain:
 * InputGain → EQ → Compressor → Saturation → StereoWidth → Limiter → Metering → Destination
 *
 * Callers connect their source to chain.input and chain.output to the analyser/destination.
 */

import { EQNode } from "./nodes/eq";
import { StereoWidthNode } from "./nodes/stereo-width";
import { CompressorNode } from "./nodes/compressor";
import { LimiterNode } from "./nodes/limiter";
import { SaturationNode } from "./nodes/saturation";
import { MeteringNode, type MeteringMessage } from "./nodes/metering";
import type { AudioParams } from "@/lib/stores/audio-store";
import type { SaturationMode } from "@/types/mastering";

export class ProcessingChain {
  private readonly _ctx: AudioContext;
  private _inputGain: GainNode | null = null;
  private _outputGain: GainNode | null = null;
  private _eq: EQNode | null = null;
  private _compressor: CompressorNode | null = null;
  private _saturation: SaturationNode | null = null;
  private _stereoWidth: StereoWidthNode | null = null;
  private _limiter: LimiterNode | null = null;
  private _metering: MeteringNode | null = null;
  private _processingAvailable = false;

  onMetering: ((data: MeteringMessage) => void) | null = null;

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

  async init(): Promise<void> {
    this._inputGain = this._ctx.createGain();
    this._outputGain = this._ctx.createGain();

    // Try loading all worklets — fall back to bypass if any fail
    try {
      this._compressor = new CompressorNode(this._ctx);
      this._limiter = new LimiterNode(this._ctx);
      this._saturation = new SaturationNode(this._ctx);
      this._metering = new MeteringNode(this._ctx);

      await Promise.all([
        this._compressor.init(),
        this._limiter.init(),
        this._saturation.init(),
        this._metering.init(),
      ]);

      // Wire metering callback
      this._metering.onMetering = (data) => {
        if (this.onMetering) this.onMetering(data);
      };

      this._eq = new EQNode(this._ctx);
      this._stereoWidth = new StereoWidthNode(this._ctx);

      // Chain: inputGain → EQ → Compressor → Saturation → StereoWidth → Limiter → Metering → outputGain
      this._inputGain.connect(this._eq.input);
      this._eq.output.connect(this._compressor.input);
      this._compressor.output.connect(this._saturation.input);
      this._saturation.output.connect(this._stereoWidth.input);
      this._stereoWidth.output.connect(this._limiter.input);
      this._limiter.output.connect(this._metering.input);
      this._metering.output.connect(this._outputGain);

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
    }
  }

  dispose(): void {
    this._inputGain?.disconnect();
    this._eq?.dispose();
    this._compressor?.dispose();
    this._saturation?.dispose();
    this._stereoWidth?.dispose();
    this._limiter?.dispose();
    this._metering?.dispose();
    this._outputGain?.disconnect();
  }
}
