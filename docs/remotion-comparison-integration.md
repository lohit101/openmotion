# Remotion comparison integration

The user accepted both complete comparison videos on 4 November 2026 and requested their integration for personal testing on simpler footage. This release integrates the hand/blink route and the shared-context later-reference route. It does not enable the subsequent source53 eye-calibration or source-relative head-rotation still experiments.

## Facial finishing

New `source-face-v11` extends the frozen Standard + ONNX60 calibrated boundary recipe. **Protect hands & track visible eyes · beta** selects it when scene matching, feature cleanup, eye calibration and boundary blending are enabled and optional eye restoration is off.

The worker observes the exact prepared source and generated video independently. It detects hands throughout each video, segments bounded groups on the managed GPU, and freezes a separate mask bank for each input. Final compositing retains the generated video's own foreground pixels; it does not paste the original actor's hands or skin onto the replacement.

Clear-face frames retain the existing v10 expression/identity finish with a final target-hand veto. If the primary source detection fails, a bounded 203-point track can recover one computed-clear eye from a real clear source observation. The fallback edits only that eye's complete orbital footprint. It leaves the mouth, brows, jaw and surrounding scene alone. Multiple faces, differing source-person associations, unavailable masks, excessive tracking gaps or ambiguous eye visibility preserve the frame instead of forcing a correction.

The prototype's frame8, image-left-only policy and early single-hand prompts are not production inputs. The controller chooses source-bound clear observations, supports either uniquely visible image-side eye, and scans for late or multiple hands. These changes make the route reusable; the initial managed GPU quality of the generalized implementation still needs user testing. Its demonstrated scope is continuous single-person clips and hand occlusion, not arbitrary cuts, cars, full occlusion or guaranteed reacquisition.

Four explicitly downloaded weights add **278,680,312 bytes** (about279 MB): the 203-point observer, palm and hand observers, and SAM2.1 Tiny. Existing facial and video weights are reused. The CUDA tracking stage finishes and releases its memory before the facial appearance/warping models load. Palm/hand observation uses OpenCV's CPU backend; the 203-point observer and SAM use explicitly checked CUDA providers when needed. Receipts distinguish unused models from executed stages.

Download/update remains explicit through the existing module button. The runtime reuses the managed engine's Torch installation and installs isolated tracking dependencies plus hash-pinned official source. Generate never resumes compute or downloads these weights. Per-frame masks, tracks, original pixels and completed output are hash-bound to the exact job, source, target, reference and recipe. Interrupted preparation and facial output resume independently. Fully downloaded output can be finalized offline.

## Native video generation

New Viggle jobs freeze `viggle-context124-v2`. Short source conditioning is held to the evaluated124-position context while only actual source positions are accepted in the output. Historical jobs keep their original native graphs.

For a prepared reference from later in the clip, new `shared-anchor-v2` generates earlier motion in reverse and later motion forward. The first five reverse appearance frames are reordered into chronological source order, re-encoded and pinned as the forward overlap. Assembly retains one reference anchor and the original chronological source/audio mapping. Native histories, source ranges, bridge float tensors and parent/child identities are validated; completed branches are reused after interruptions.

The application's existing compressed branch exports remain in use. The private comparison's lossless PNG master is not claimed as pixel-identical to those application exports. The shared float overlap and accepted frame mapping remain explicit. These changes do not supply cut detection or an independently repainted appearance for each shot.

Existing online GPUs get the helper-code update through the same Download/update action, before facial preparation. The updater verifies an idle owned engine and updates only Recast's helper files. It does not rent/resume a GPU, install model weights or interrupt an active render. Unknown update status remains busy and recovery observes the existing attempt instead of launching another.

## Compatibility and release checks

Facial v1–v10 formulas, fingerprints, saved settings and paid originals are preserved. New-user defaults enable the new facial flag, while missing historical fields remain false. Activating the current user's new flag is separate from reloading the server and preserves their other draft settings. Source53 calibration and driven-rotation experiments stay private.

The local test suite covers array ownership, unknown masks, either eye, double-veto prevention, source association barriers, exact input/frame bindings, preparation cancellation/resume, native overlap ordering, historical graphs and explicit tool-update behavior. These tests establish protocol and implementation behavior; they are not fresh managed-GPU visual validation or a claim of universally consistent identity.

## Tool-preparation repair

The first live setup exposed two installer defects. The detached setup launcher's version allowlist omittedv11, and its observer treated the resulting application rejection as a transport failure. It therefore retried without ever starting installation. The launcher now accepts the new recipe; application and malformed-status failures reach the UI, while actual SSH transport failures continue observing the same request.

After independently confirming that no remote setup worker existed, the local observer was cancelled through the existing model API and setup retried. All18 selected model files were already installed and reused. The actual installer then encountered four official YAML symlink aliases in the checksum-pinned SAM source archive. The extractor now resolves only safe in-archive source targets and materializes ordinary files, without following or creating filesystem links. All41 selected files in the real archive were compared byte for byte; escape, cycle, missing-target, duplicate and special-entry tests cover rejection paths.

The live module completed with **Ready for these settings**, all18 files installed, and native/facial capabilities ready. No Studio restart or GPU inference was required. The full Python suite now passes322 checks, including11 setup/archive regressions. The repair preceded any savedv11 generation and preserves all earlier facial fingerprints. See [the repair receipt](validation/remotion-tool-preparation-repair-20261104.json).
