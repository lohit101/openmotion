# Realism baseline and next comparison

The GPU capture is complete under the ignored directory `backups/realism-20261024-104150/`. Three user-submitted renders finished and the queue was empty. Inputs, references, normalized source videos, final videos, graph/history records, source and reference masks, continuation tensors, runtime code/configuration and a SQLite backup are available locally. Both capture archives have SHA256 hashes in `validation/realism-baseline.json`; all nine image/video files referenced by ComfyUI history were found in the archive. No new render was submitted for this capture.

Git now records the source/workflow baseline. `AGENTS.md` requires a focused commit after each completed fix or feature. Credentials, user media, the Studio database and raw GPU captures remain ignored. Pause/unpause stays under the user's control; further GPU validation must wait for authorization.

## Observed failure

The contact sheet at `backups/realism-20261024-104150/analysis/source-vs-three-renders.jpg` compares synchronized frames 4, 12 and 20 (0.25, 0.75 and 1.25 seconds). The source is a close upper-body shot. All three generated variants show a smaller subject and more of the body. They also regenerate much of the room. Raising the run to 20 steps or 704p did not fix that framing mismatch in this example.

The prompt in all three runs still describes the original demo: a black outfit, cargo trousers, boots, gray/yellow curtains, plants and a sofa. Those scene instructions conflict with the new source and reference. The generated room resembles those instructions. Prompt leakage is an observed problem; its contribution to the scale drift needs an isolated comparison.

The source mask selects the large foreground person, rather than a small background object. At frame 4 it covers 57.14% of the canvas; the fitted reference mask covers 30.28%. See `analysis/conditioning-masks.jpg` and `analysis/mask-metrics.json` in the capture. These are foreground-mask measurements, not face-size or identity scores.

`SwapFitReference` currently letterboxes the entire reference image. It does not align the reference face/torso to the source face/torso or normalize camera distance. The native SCAIL node receives that reference geometry. This is a second candidate cause of the farther-camera appearance; it has not yet been proven by a GPU comparison.

## Changes to evaluate

1. Replace the demo-specific default with instructions that assign identity/outfit to the reference and camera/background/position/scale to the source. Keep user prompts as optional refinements and avoid carrying an untouched demo prompt into new inputs.
2. Prepare a source-relative reference using face/torso anchors and matching transforms for its image and identity mask. A whole-body bounding-box fit alone is insufficient when the source is cropped at the waist. Keep a fallback for unreliable detection and expose diagnostics before making this the default.
3. Evaluate preservation of the original background and occlusion boundaries. Any compositing must handle the old subject's exposed regions and the replacement silhouette; a simple hard mask can leave ghosts or clipped clothing.

Use the same inputs, seed, frame window and sampler for prompt-only and geometry comparisons. Measure normalized face/torso placement, scale, background changes, mask edge quality and temporal drift. Keep the current videos as controls. Additional LoRAs or more steps are not established fixes for these geometry errors.

The queued still-image face/body preparation and character-profile workflow is a separate follow-up. The present capture/review does not claim that the installed video model is a validated face-swap editor.
