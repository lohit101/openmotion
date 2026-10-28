# Remotion / Imagen refresh validation — 2026-10-29

Status: implemented; offline protocol/CPU/browser validation passed. **No GPU quality pass claimed.** No new paid inference or model download was used.

- The full Studio regression suite passed: 37 files / 393 tests. After adding local-runtime/file preflight, the segment-refresh/Viggle focused suite passed 16 tests, including the new missing-tools/unreadable-sheet rejection.
- Mock Comfy protocol verified serial video → photo → video, saved-photo download recovery without duplicate paid submission, parent/child cancellation, immutable native failure plus explicit new-child retry, and approved starting-photo handoff with frozen character views and selected duration preserved. Its 126-frame source deliberately exercised a 107-frame terminal overlap. These synthetic passthrough outputs are not model-quality evidence.
- Four Python raw-frame/face-scope tests passed: regular and larger overlaps, strict job/range/canvas/tensor checks, hidden/multiple-face behavior, and cached receipt tampering.
- All 27 image preparation/finalization tests passed, including the new cap on mask growth and exact body/scene pixels outside the head scope. Scope content is included in preparation fingerprints.
- Fifteen existing paid photo graphs, including accepted `545ff68d-173f-4acd-98bf-c805f57cea90`, recompiled identically. No paid original was changed.
- A CPU-only audit of an existing v2 continuation from `67eeeca5-a19c-49eb-be79-b76791669a48` extracted its raw appearance PNG and matched its previously saved appearance preview with maximum pixel difference **0**. The face scope was inspected visually. This is an extraction check, not a new generation or identity evaluation. The newer v1 job `56094f66-1da4-4e8e-ab49-7651ff0eb0fe` was correctly rejected as an incompatible anchor rather than converted implicitly.
- Isolated browser QA with its own ignored database verified actual character dropdown selection, toggle state, saved crop previews, clip trimming, opening the exact selected start frame in Imagen with character provenance and a fresh mask, and a 390px layout without horizontal overflow. A first-visit CSS loading issue was fixed by importing shared crop styles with their component. Screenshots were reviewed after the fix.
- Production build/type checking and whitespace checks passed. Raw screenshots, protocol logs, runtime captures and media remain under ignored `backups/segment-repaint-20261029/`.

The user's existing two-segment job was allowed to finish. The production server was only eligible for reload after generation, model transfers, provider actions, face setup/refinement and local exports were checked idle. No GPU resume was needed. The saved Samaira character remains local; sheets and generated media are excluded from Git.

Next comparison: use the same continuous-shot input, approved starting repaint and sampling settings with/without `imagen-face-v1`; inspect synchronized face frames before/after the boundary, inside the next segment and near its end. Record actual end-to-end timing and transfer/compute costs separately. Until then, the expected identity benefit remains a hypothesis.
