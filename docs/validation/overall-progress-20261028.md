# Continuous progress and inline insights

The user's later 2026-10-28 request supersedes the stage-only percentage and popup behavior.

The simple processing canvas has one 0–100 overall indicator and no native-stage bar. It uses fixed work budgets for input preparation, each model's sampler passes, segment decoding/exports/transfers and final local assembly/review. Native counters earn progress within that budget; it is a weighted completion estimate, not a measured fraction of remaining time. Image identity-first ordering and optional body-reference/head/lighting passes have distinct budgets. Counter resets between two transfers or subsequent segments never reset overall progress.

High-water marks are scoped by immutable job ID in tab session storage with an in-memory fallback. Unknown stages hold; reconnect/interruption/failure do not advance the stored mark. Numeric animation only eases toward already earned progress. Incomplete output is capped at 99, and only a completed job with an output reaches 100. Newly completed jobs briefly show their actual 100 before the existing result view appears; opening an older completed result is immediate. No execution settings or outputs are changed.

Info replaces the simple canvas with a scrollable inline Render details view. Back/Escape returns to the simple view and restores button focus. The current-stage bar, bytes/steps, elapsed time, segment/frame counts and conditioning-frame link remain here. No dialog, portal, modal backdrop or focus trap is used. Errors and explicit cancel/recovery controls remain visible.

Validation: TypeScript/production build, diff whitespace check, and ten tests across continuous progress, library and framing pass. New scenarios cover queued zero, post-sampler/assembly completion bounds, missing output, segment/two-transfer resets, stalled counters, recovery freezes, identity-first pass order, native detail counters, and no technical bar/dialog in the default summary. No inference, model transfer, runtime restart or GPU control was needed. Browser interaction/animation has not had a complete visual sweep.
