# Aurialis

Browser-based audio mastering application. Upload a track, choose a genre preset or tweak parameters manually, and export a mastered WAV file.

## Features

- **Simple mode** — genre presets with intensity control and quick toggles (warm, bright, wide, loud, cleanup)
- **Advanced mode** — full parametric EQ, compressor, limiter, saturation, and stereo width controls
- **Auto Master** — analyzes audio and suggests genre + intensity settings
- **Real-time metering** — LUFS, true peak, dynamic range, and L/R level meters
- **Export** — WAV output at 16/24/32-bit with optional TPDF dither
- **A/B bypass** — compare processed vs. original audio

## Audio Architecture

```
Source → InputGain → [ProcessingChain] → OutputGain → Analyser → Destination
```

The processing chain runs in AudioWorklets for thread-safe, low-latency processing:

- **DSP math** (`src/lib/audio/dsp/`) — biquad filters, compressor, limiter, saturation, LUFS metering
- **AudioWorklets** (`public/worklets/`) — compressor, limiter, saturation, and metering processors
- **Node wrappers** (`src/lib/audio/nodes/`) — connect Web Audio API nodes to worklet processors
- **Chain** (`src/lib/audio/chain.ts`) — wires nodes into the full signal path
- **Engine** (`src/lib/audio/engine.ts`) — manages playback, seeking, and visualization data
- **Parameter bridge** (`src/lib/audio/parameter-bridge.ts`) — syncs Zustand store params to engine

## Tech Stack

- **Framework** — Next.js 15 (App Router, standalone output)
- **State** — Zustand
- **Styling** — Tailwind CSS 4
- **Animation** — Motion (Framer Motion)
- **Testing** — Vitest (unit), Playwright (E2E)
- **Deployment** — Cloudflare Workers via `@opennextjs/cloudflare`
- **Package manager** — pnpm

## Development

```bash
pnpm install
pnpm dev          # Start dev server on port 3000
```

### Linting & Type Checking

```bash
pnpm run lint         # ESLint (Next.js + React hooks rules)
pnpm exec tsc --noEmit  # TypeScript type check
```

### Testing

```bash
pnpm test                             # Unit tests (Vitest)
pnpm test -- --coverage               # With coverage report
pnpm run test:generate-signals        # Generate test WAV fixtures
pnpm exec playwright test --workers=2 # E2E tests
```

### Build & Deploy

```bash
pnpm run build     # Next.js production build
pnpm run preview   # Local Cloudflare Workers preview
pnpm run deploy    # Deploy to Cloudflare Workers
```

## Browser Requirements

AudioWorklet and `SharedArrayBuffer` are required for the processing chain. The app sets `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers to enable `SharedArrayBuffer`.

| Browser | Support |
|---------|---------|
| Chrome / Edge | Full |
| Firefox | Full (AudioWorklet supported since v76) |
| Safari | Partial (AudioWorklet since v14.1, some worklet limitations) |

If AudioWorklet loading fails, the engine falls back to bypass mode (audio plays unprocessed).

## Project Structure

```
src/
├── app/              # Next.js pages (upload, master)
├── components/       # React components (mastering UI, visualizations, export)
├── hooks/            # React hooks (useAudioEngine, useVisualization)
├── lib/
│   ├── audio/        # Audio engine, DSP, presets, export
│   │   ├── dsp/      # Pure math: biquad, compressor, limiter, saturation, LUFS
│   │   └── nodes/    # AudioWorklet node wrappers
│   └── stores/       # Zustand stores
├── types/            # Shared TypeScript types
└── test/             # Test setup and signal generators
public/
└── worklets/         # AudioWorklet processor scripts
e2e/                  # Playwright E2E tests
```
