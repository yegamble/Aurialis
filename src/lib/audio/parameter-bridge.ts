/**
 * ParameterBridge — subscribes to Zustand store param changes and routes
 * them to the AudioEngine with debouncing to prevent overwhelming AudioParam ramps.
 */

import { useAudioStore, type AudioParams } from "@/lib/stores/audio-store";
import type { AudioEngine } from "./engine";

const DEBOUNCE_MS = 16; // ~60fps

export class ParameterBridge {
  private readonly _engine: AudioEngine;
  private _unsubscribe: (() => void) | null = null;
  private _timers = new Map<keyof AudioParams, ReturnType<typeof setTimeout>>();
  private _prevParams: AudioParams | null = null;

  constructor(engine: AudioEngine) {
    this._engine = engine;
    this._subscribe();
  }

  private _subscribe(): void {
    this._unsubscribe = useAudioStore.subscribe((state, prevState) => {
      const params = state.params;
      const prev = prevState.params;
      if (params === prev) return;

      // Find changed keys and debounce each one
      const keys = Object.keys(params) as (keyof AudioParams)[];
      for (const key of keys) {
        if (params[key] !== prev[key]) {
          // Clear existing timer for this key
          const existing = this._timers.get(key);
          if (existing !== undefined) clearTimeout(existing);

          // Schedule debounced update
          const timer = setTimeout(() => {
            this._timers.delete(key);
            this._engine.updateParameter(key, params[key]);
          }, DEBOUNCE_MS);

          this._timers.set(key, timer);
        }
      }
    });
  }

  /** Unsubscribe from store and cancel all pending updates */
  destroy(): void {
    this._unsubscribe?.();
    this._unsubscribe = null;
    for (const timer of this._timers.values()) {
      clearTimeout(timer);
    }
    this._timers.clear();
  }
}
