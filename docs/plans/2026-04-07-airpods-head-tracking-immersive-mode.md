# AirPods Head Tracking Immersive Mode — Implementation Plan

Created: 2026-04-07
Fleshed out: 2026-06-19 (was an abandoned exploration stub)
Author: yegamble@gmail.com
Status: PENDING — feasibility-gated, NOT yet approved
Approved: No
Type: Feature
Worktree: TBD

## Goal

An immersive "head-tracked spatial" preview mode: rotate the stereo/mix audio
scene in response to the listener's head orientation so sources feel fixed in
space (à la Apple Spatial Audio with Dynamic Head Tracking).

## ⚠️ Feasibility constraint (read first)

**AirPods head-tracking orientation is NOT exposed to web browsers.** Apple's
head-pose data comes from `CMHeadphoneMotionManager` (CoreMotion), a *native*
iOS/macOS API with no Web equivalent — Safari does not surface AirPods IMU data
to JavaScript. Therefore a browser-only Aurialis cannot read true AirPods head
tracking. Two honest paths:

1. **Web proxy (shippable now):** use the **DeviceOrientation API** (the
   *device's* orientation, e.g. a phone/tablet held by the listener) or the
   Generic Sensor API as a *proxy* for head orientation, and rotate the audio
   scene with Web Audio (`PannerNode` HRTF or an Ambisonic rotation). This is
   NOT true AirPods head tracking and must be labelled as "device-tracked
   spatial preview" to avoid over-promising.
2. **Native bridge (out of scope for the web app):** a future iOS/macOS wrapper
   (Capacitor/native shell) that reads `CMHeadphoneMotionManager` and posts
   quaternions to the web layer. Defer until/if a native app exists.

This plan scopes **Path 1** as the realistic deliverable and documents Path 2 as
a follow-up.

## Scope (Path 1)

- Add an opt-in "Spatial preview (beta)" toggle, gated behind Pro Mode and a
  capability check (`DeviceOrientationEvent` present + permission granted; iOS
  requires `DeviceOrientationEvent.requestPermission()` on a user gesture).
- Build an HRTF spatialization graph: decode the current master/mix to a few
  virtual source positions (e.g. L/C/R or per-stem), feed through `PannerNode`
  (`panningModel: "HRTF"`), and rotate the listener orientation each frame from
  the smoothed device-orientation quaternion via `AudioListener` orientation.
- Smooth orientation (one-pole / slerp) to avoid zipper artifacts; clamp update
  rate to the audio render cadence.
- Clear UX copy: "device-tracked", with a tooltip explaining the AirPods-API
  limitation.

### Out of scope

- True AirPods/CoreMotion head tracking (native only — Path 2).
- Binaural export (preview only).
- Per-stem 3D authoring UI.

## Phases

| # | Phase | Deliverable | Test contract |
|---|-------|-------------|---------------|
| 1 | Capability + permission | `useDeviceOrientation()` hook (feature-detect, iOS permission prompt, graceful absent state) | unit: returns `{supported:false}` when API missing; resolves quaternion stream when granted |
| 2 | Spatial graph | `SpatialScene` Web Audio graph (PannerNode HRTF sources + AudioListener) | unit: listener orientation updates change per-ear gain for a panned source |
| 3 | Rotation binding | bind smoothed orientation → AudioListener each frame | unit: a 90° yaw swaps L/R dominance for a front source |
| 4 | UI | Pro-Mode "Spatial preview (beta)" toggle + capability/permission UX + limitation tooltip | RTL + Playwright |

## Acceptance — complete when

- The toggle is hidden/disabled with a clear message when DeviceOrientation is
  unavailable or permission is denied.
- With permission granted, rotating the device audibly rotates the scene
  (verified by per-ear gain assertions in unit tests).
- Copy never claims "AirPods head tracking"; it says "device-tracked spatial
  preview (beta)" and links the limitation note.
- `pnpm test` / `pnpm test:e2e` / `pnpm lint` / `pnpm exec tsc --noEmit` green.

## Risk register

| Risk | Mitigation |
|------|------------|
| Over-promising "AirPods head tracking" | Explicit beta/device-tracked labelling + tooltip |
| iOS permission friction | Request on user gesture; degrade gracefully |
| Motion-to-audio latency / jitter | One-pole/slerp smoothing; cap update rate |
| HRTF CPU cost on mobile | Limit virtual source count; Pro-Mode gate |

## Rollback

Additive, behind a Pro-Mode beta toggle; revert the feature commits to remove.
