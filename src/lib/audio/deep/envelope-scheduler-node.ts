/**
 * Test-only re-export of the EnvelopeScheduler class from
 * src/worklets/envelope-scheduler.js. The .js file installs the class on
 * `globalThis` so AudioWorklet processors can reference it after inlining;
 * here we evaluate it under Node and re-export the typed class.
 *
 * KEEP IN SYNC: when src/worklets/envelope-scheduler.js gains a method,
 * extend the type below.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface EnvelopeScheduler {
  setEnvelope(param: string, points: ReadonlyArray<readonly [number, number]>): boolean;
  clearEnvelope(param: string): void;
  hasEnvelope(param: string): boolean;
  getValueAt(param: string, time: number, fallback: number): number;
  smootherCoefficient(tauSec: number, sampleRate: number): number;
  smoothStep(param: string, target: number, coeff: number): number;
}

interface SchedulerCtor {
  new (): EnvelopeScheduler;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(HERE, "../../../worklets/envelope-scheduler.js");

function loadScheduler(): SchedulerCtor {
  const code = readFileSync(SOURCE, "utf8");
  // Evaluate the IIFE-style script. It assigns globalThis.EnvelopeScheduler.
  // Use Function constructor to keep top-level isolated from the test module.
  const fn = new Function(code + "\nreturn globalThis.EnvelopeScheduler;");
  const Ctor = fn() as SchedulerCtor | undefined;
  if (!Ctor) {
    throw new Error("envelope-scheduler.js did not assign EnvelopeScheduler on globalThis");
  }
  return Ctor;
}

export const EnvelopeScheduler = loadScheduler() as unknown as SchedulerCtor;
