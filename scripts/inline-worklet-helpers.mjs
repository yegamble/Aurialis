#!/usr/bin/env node
/**
 * Inline shared worklet helpers into AudioWorklet processor files.
 *
 * Per Spike S1 (2026-04-25): Cloudflare Workers / @opennextjs/cloudflare
 * may not support AudioWorklet `importScripts` reliably. This postbuild
 * step replaces marker comments inside `public/worklets/*-processor.js`
 * with the inlined contents of `src/worklets/<helper>.js`. Idempotent —
 * uses BEGIN/END marker pairs so subsequent runs replace cleanly.
 *
 * Helpers handled:
 *   - envelope-scheduler  →  src/worklets/envelope-scheduler.js
 *
 * Marker contract — each processor must contain:
 *
 *   // @@INLINE_BEGIN: envelope-scheduler
 *   // @@INLINE_END: envelope-scheduler
 *
 * Everything between the markers is replaced. The markers themselves are
 * preserved so the file remains self-describing and re-runnable.
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const HELPERS_DIR = path.join(ROOT, "src", "worklets");
const PROCESSORS_DIR = path.join(ROOT, "public", "worklets");

const HELPERS = ["envelope-scheduler"];

function loadHelper(name) {
  const p = path.join(HELPERS_DIR, `${name}.js`);
  return readFileSync(p, "utf8").trimEnd();
}

function inlineHelperInto(processorPath, helperName, helperSource) {
  const original = readFileSync(processorPath, "utf8");
  const begin = `// @@INLINE_BEGIN: ${helperName}`;
  const end = `// @@INLINE_END: ${helperName}`;
  const beginIdx = original.indexOf(begin);
  if (beginIdx < 0) return { changed: false, reason: "no begin marker" };
  const endIdx = original.indexOf(end, beginIdx + begin.length);
  if (endIdx < 0) {
    throw new Error(
      `${processorPath}: found '${begin}' but no matching '${end}'`,
    );
  }
  const replacement = `${begin}\n${helperSource}\n${end}`;
  const next =
    original.slice(0, beginIdx) +
    replacement +
    original.slice(endIdx + end.length);
  if (next === original) return { changed: false, reason: "already up-to-date" };
  writeFileSync(processorPath, next, "utf8");
  return { changed: true };
}

function main() {
  const helperSources = Object.fromEntries(
    HELPERS.map((name) => [name, loadHelper(name)]),
  );

  const processors = readdirSync(PROCESSORS_DIR)
    .filter((f) => f.endsWith("-processor.js"))
    .map((f) => path.join(PROCESSORS_DIR, f));

  let changed = 0;
  let touched = 0;
  for (const proc of processors) {
    for (const helperName of HELPERS) {
      const src = helperSources[helperName];
      const result = inlineHelperInto(proc, helperName, src);
      if (result.changed) changed++;
      if (result.changed || result.reason === "already up-to-date") touched++;
    }
  }
   
  console.log(
    `[inline-worklet-helpers] processed ${processors.length} processors, ${touched} marker pairs found, ${changed} updated`,
  );
}

main();
