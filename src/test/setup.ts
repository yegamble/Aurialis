/// <reference types="vitest" />
import { webcrypto } from "node:crypto";
import "@testing-library/jest-dom/vitest";

// AudioWorklet mock — must be defined before MockAudioContext
class MockAudioWorklet {
  addModule = vi.fn().mockResolvedValue(undefined);
}

// AudioWorkletNode mock — wraps a port for message passing
class MockAudioWorkletNode {
  port = {
    postMessage: vi.fn(),
    onmessage: null as ((e: MessageEvent) => void) | null,
  };
  connect = vi.fn();
  disconnect = vi.fn();
  constructor(_ctx: unknown, _name: string, _opts?: unknown) {}
}

Object.defineProperty(globalThis, "AudioWorkletNode", {
  value: MockAudioWorkletNode,
  writable: true,
});

// Mock AudioContext for tests
class MockAudioContext {
  sampleRate = 44100;
  state: AudioContextState = "running";
  destination = {} as AudioDestinationNode;
  currentTime = 0;
  audioWorklet = new MockAudioWorklet();

  createGain() {
    return {
      gain: {
        value: 1,
        linearRampToValueAtTime: vi.fn(),
        setValueAtTime: vi.fn(),
        cancelScheduledValues: vi.fn(),
        setTargetAtTime: vi.fn(),
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }

  createAnalyser() {
    return {
      fftSize: 2048,
      frequencyBinCount: 1024,
      getFloatFrequencyData: vi.fn(),
      getByteFrequencyData: vi.fn(),
      getFloatTimeDomainData: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }

  createBiquadFilter() {
    return {
      type: "lowpass",
      frequency: { value: 350, linearRampToValueAtTime: vi.fn() },
      gain: { value: 0, linearRampToValueAtTime: vi.fn() },
      Q: { value: 1, linearRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }

  createBufferSource() {
    return {
      buffer: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null,
      loop: false,
      playbackRate: { value: 1 },
    };
  }

  createStereoPanner() {
    return {
      pan: { value: 0, linearRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }

  createDynamicsCompressor() {
    return {
      threshold: { value: -24 },
      ratio: { value: 12 },
      knee: { value: 30 },
      attack: { value: 0.003 },
      release: { value: 0.25 },
      reduction: 0,
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }

  createWaveShaper() {
    return {
      curve: null as Float32Array | null,
      oversample: "none" as OversampleType,
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }

  createChannelSplitter(_numberOfOutputs?: number) {
    return { connect: vi.fn(), disconnect: vi.fn() };
  }

  createChannelMerger(_numberOfInputs?: number) {
    return { connect: vi.fn(), disconnect: vi.fn() };
  }

  async decodeAudioData(_buffer: ArrayBuffer) {
    return {
      duration: 10,
      length: 441000,
      numberOfChannels: 2,
      sampleRate: 44100,
      getChannelData: () => new Float32Array(441000),
    };
  }

  async close() {
    this.state = "closed" as AudioContextState;
  }

  async resume() {
    this.state = "running" as AudioContextState;
  }
}

class MockOfflineAudioContext extends MockAudioContext {
  constructor(
    public numberOfChannels: number,
    public length: number,
    sampleRate: number
  ) {
    super();
    this.sampleRate = sampleRate;
  }

  async startRendering() {
    return {
      duration: this.length / this.sampleRate,
      length: this.length,
      numberOfChannels: this.numberOfChannels,
      sampleRate: this.sampleRate,
      getChannelData: () => new Float32Array(this.length),
    };
  }
}

Object.defineProperty(globalThis, "AudioContext", {
  value: MockAudioContext,
  writable: true,
});

Object.defineProperty(globalThis, "OfflineAudioContext", {
  value: MockOfflineAudioContext,
  writable: true,
});

// Polyfill Blob.prototype.arrayBuffer for jsdom (used by stem-loader)
if (typeof Blob !== "undefined" && !Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function () {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

// jsdom doesn't ship Web Crypto. Polyfill from Node's webcrypto so
// crypto.subtle.digest works in tests (used by library-fingerprint).
if (typeof globalThis.crypto === "undefined" || typeof globalThis.crypto.subtle === "undefined") {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: webcrypto,
  });
}

// Mock URL.createObjectURL
Object.defineProperty(URL, "createObjectURL", {
  value: vi.fn(() => "blob:mock-url"),
  writable: true,
});

Object.defineProperty(URL, "revokeObjectURL", {
  value: vi.fn(),
  writable: true,
});
