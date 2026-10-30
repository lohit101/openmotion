# Imagen source head layout

New native body-only photos use `body-only-v8`; the two-image route uses `body-only-single-v3`. The previous concise instruction preserved pose in general but omitted an explicit apparent-head-size constraint. On the reported frame it produced a smaller frontal face despite a turned, tilted source head, with a poorly attached earring.

The new frozen instruction assigns head size, center, tilt, turn, camera distance and crop to the source. Facial proportions and hair appearance still come from the identity reference. It requests one connected head/ears/hair arrangement and naturally attached source earrings, rather than a small replacement face inside retained hair.

Local YuNet measurements add source-specific tilt and coarse turn-direction cues when one sufficiently large, clear face is available. This is an image-space eye-line/nose-asymmetry heuristic, not 3-D pose estimation or identity recognition. Small, hidden, ambiguous or unmeasurable faces do not receive invented directional instructions. The metadata is frozen in a hashed preparation receipt; the actual graph contains the full conditioning text. Finalization records size, center and direction differences for review. It does not resize, reshape or warp the generated face.

The selected route retains the existing four Qwen/Turbo files, 1 MP and eight CFG-1 Euler/simple steps. It adds no image sampling pass, reference image, model transfer or face-swap stage. Old native v7/single-v2, staged/head experiments, paid graphs and saved segment-repaint recipes retain their existing behavior. This change is for new standalone Imagen requests; it does not silently change a running video or its segment refresh.

## Evaluation and limits

Three same-input/seed comparisons were run on the user's existing A6000 after their video and facial finishing completed. All outputs and the rejected original remain under the ignored `backups/imagen-head-layout-20261030/` directory. The source frame, previous output and selected new output were opened side by side in macOS Preview, with a separate same-coordinate head/ear close-up.

| Route | Native GPU execution | Face-height ratio to source | Eye-line difference | Nose-offset difference |
| --- | ---: | ---: | ---: | ---: |
| Previous paid result | 16.242 s | 0.921 | 9.51° | 0.317 |
| Selected full layout instruction | 13.189 s | 0.915 | 6.16° | 0.024 |
| Shorter instruction | 9.963 s | 0.909 | 4.48° | 0.139 |
| Extra numerical scale instruction | 10.042 s | 0.913 | 6.26° | 0.037 |

Execution times are native prompt-history durations, not complete Generate latency or a controlled speed benchmark. Test wall times including transfers/checks were 31.924, 28.635 and 34.411 seconds; time between tests is additional. The full layout route improved the inspected side turn and ear/earring attachment. The shorter route changed the neckline/necklace, and numerical size instructions did not improve scale. The selected output remains about 9% shorter in detected face height: **this is an improvement in pose/attachment, not an exact head-scale lock or universal quality pass**. Detection boxes and nose offsets also depend on identity and perspective; none is an identity-accuracy score.

A separate CPU-only semantic-mask/affine enlargement of the saved result brought the detected height closer but created visible hair, neck and scene seams. It is preserved privately and rejected; no such warp or parser dependency is enabled in the app.

The user authorized three tests with a 3¢ cap. All three completed, with no new model download or rental/resume. The first stop response was unconfirmed; a subsequent independent provider refresh confirmed the rental exited/stopped and the disk retained. A conservative estimate through confirmed stop is approximately **4.5¢ including storage**, above the requested cap. This overrun was disclosed. It is an estimate, not an invoice; there is no further paid validation authorized by this comparison budget. The user's existing idle preference was left unchanged.

Offline checks: 466 Studio tests, 27 legacy image Python checks and eight new head-layout checks passed; TypeScript/frontend/backend builds passed. Ninety-three historical image graphs compiled identically before/after this change. Six older saved-vs-compiler differences predate it and were not rewritten. Existing jobs, outputs and drafts remain immutable.

The local build was deployed only after a fresh idle check; an earlier attempt correctly deferred for user work. All 252 saved job rows and both generation drafts were byte-for-byte unchanged across the reload. The new account-setup route from the preceding commit is also available. No GPU was resumed by deployment; refresh the Recast tab to load the current client.

The instruction design follows [Qwen's official editing guidance](https://github.com/QwenLM/Qwen-Image-2.1/blob/main/prompt_rewrite/prompts/system_prompt_edit.txt): assign each reference a role and preserve untargeted attributes explicitly. The existing eight-step adapter/settings are documented by [Comfy-Org](https://huggingface.co/Comfy-Org/Qwen-Image-2.1). A structural-control model would be a separate additional dependency and evaluation; it is not silently enabled here.
