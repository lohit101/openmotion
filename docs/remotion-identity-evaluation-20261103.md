# Remotion identity and difficult-opening evaluation

This evaluation uses the user-authorized existing A100-SXM4-40GB rental, short saved clips and existing model files. No new rental or weight download was made. It is a research comparison, not a new quality-certified production recipe.

## Why a face sheet is not a native identity lock

The released Viggle pipeline is trained around a driving video and one repainted frame from that shot. Its fixed conditioning supplies no explicit identity encoder, person-selection mask, body-marker channel or face-sheet input. The publisher distinguishes the unreleased multi-cut demonstration from these weights. MiniMax-H3's broader reference features do not establish that the distilled Viggle finetune will use arbitrary extra face images reliably. [Viggle model card](https://huggingface.co/Viggle/Viggle-Animate).

Community work adds per-chunk references, timed visual guides and attention schedules, rather than a proven plug-in identity lock. Its author describes sparse guidance and attention strength as controls that need tuning. We evaluated the underlying approaches with our existing native runtime; no third-party GPL implementation was copied into production. [VK Vigglorious Studio](https://github.com/Tablaski/VK-Vigglorious-Studio).

Our current source-driven expression stage derives canonical keypoints, appearance and pose from each generated target frame. It changes expression using the original source video. The following fixed-donor Hyperswap stage restores likeness at a 60% RGB blend, aligned to that generated face. Neither operation freezes a reference skull, jaw, eye spacing or lip width. Carrying the previous generated appearance into another segment can also carry earlier identity errors. A face sheet can help prepare appropriate views, but supplying more pictures alone does not fix those mechanisms.

## Same-input short comparisons

Two exact 73-frame, 24 fps excerpts were used: a hand covering the face and a back-facing opening with a turn. They have different character references; the second case never receives the first character's gallery. The hand case additionally uses individual front/three-quarter/profile crops from the user's saved face sheet. Full collages were not silently passed as one face.

All output timing, original references, paid parents, requests, graphs and native history are preserved privately. Reverse branches use decoded-frame hash verification, FFV1 chronological reversal and one original audio assembly. A combined backward/forward export removes only the duplicate anchor, with no hidden holds or crossfades.

| Comparison | Native worker seconds | Observed result |
| --- | ---: | --- |
| Hand, three passes | 66.160 | More doubled/ghosted fingers; rejected speed shortcut |
| Hand, five passes | 39.100 | Better hands than three passes, but an invented cuff and drift remain |
| Single face, late residual 0.1 | 39.707 | Small appearance change; no convincing quality win |
| Three face views, late residual 0.2 | 40.314 | No reliable identity lock; hand defects remain |
| Three views, strong/all-block residual 0.5 | 40.877 | Facial corruption; rejected |
| Back-facing opening, five passes | 46.145 | Incorrect initial pose and late motion |
| Back-facing opening, late face residual 0.2 | 39.358 | No convincing overall improvement |
| Back-facing opening, reverse from clear end | 45.871 | Better opening interpretation; timing still slips |
| Clear later Qwen reference, forward | 39.825 | Invented sleeve/cuff persists |
| Clear later reference, backward branch | 22.598 | 37 frames; separate exact branch |
| Clear later reference, forward branch | 22.648 | 37 frames; assembled with previous branch into 73 unique frames |
| Repainted actual covered opening | 46.483 | Cleanest sampled bare hand/forearm; delayed gesture and blink mismatch remain |
| Covered opening plus full timed guide | 80.105 | Stronger clear-face appearance; motion still differs |
| Covered opening plus face-scoped late guide | 41.139 | Visible facial artifact around guide time; rejected |
| Covered opening plus face-scoped early/late guide | 41.711 | Same artifact; rejected |

These are native prompt durations, not complete Generate times. Cold and warm model loads differ; the three-pass and full-guide cold runs must not be interpreted as steady-state speed comparisons. The scoped experiments avoid a dense video-by-video attention mask but are still not quality passes. Their code and eight passing CPU checks are archived privately, and their node registrations were removed from production.

A separate actual managed-app, later-reference run completed all 73 frames with the existing Standard + ONNX recipe in **249.707 seconds end to end**. Facial worker time was **48.920 seconds**, with 65 refined frames and eight preserved/skipped frames. Eye calibration skipped because the supplied anchor's eyes were not visible. It still generated an incorrect cuff/hand; this is not a successful full workflow validation. Two additional finishing comparisons reused the covered-opening and full-guide videos with the same clear Qwen donor at source frame 36. Their unchanged v10 workers took **49.274 / 51.449 seconds**, refining **64 / 65** frames and preserving **9 / 8**. Both eye calibrations were active. Sampled blinks and mouth openings moved closer to the source, while fine detail softened and native motion timing/facial-structure variation remained. These are face-worker times, excluding reference checks, transfers and video generation. Their inputs and verified separate outputs are preserved; neither paid video was resampled.

The invented cuff was absent from the original reference. It was initially misattributed to the reference and this was corrected after inspection. A fresh clear-frame reference alone did not fix it. Repainting the actual covered source frame helped substantially on this example, but Qwen opened a visible eye that was closed in the source. That changed expression can influence the animation.

## Qwen references and limits

Four managed Imagen photos used the existing three-reference Qwen 2.1 stack at a 1024-pixel long edge with a fixed seed. The forty-step Photo and eight-step Turbo references both retained the source's dark hair until the instruction explicitly transferred complete hair color/highlights, hairline and hairstyle. The corrected eight-step references transferred brown hair and retained the bare arm. This does not validate complete body proportions, exact jewelry, eye movement or ChatGPT-level identity. No 2048/4K or all-angle temporal quality claim follows from these tests.

The most useful direction so far is a pose- and occlusion-matched repainted scene reference, with a separate clear identity donor for finishing. Stronger attention and extra arbitrary crops did not produce a dependable result. No new identity-conditioning method, prompt default, facial formula or user draft was changed by this research.

## Remaining work

1. Test pose-matched references and fixed geometry against independent head turns and partial/offscreen faces, with the original source performance visible beside the output. Reject identity improvements that damage motion or foreground objects.
2. Use character sheets as an immutable view bank for preparation and identity review. Do not recursively treat a drifted output as the authoritative character.
3. Treat target-person tracking and shot cuts as separate orchestration problems. A point/box tracker can identify source pixels without a visible face; those prompts do not become Viggle controls automatically. Do not revive the rejected source-RGB hand overlay as a proven solution.
4. Require user review when a target or usable reference is ambiguous. Hard cuts need per-shot appearance references; a hand cover or back turn within one shot must not silently select another person.

The released workflow has not met the user's “great” general-result target. Multi-angle identity, cuts, foreground occlusion and source movement accuracy remain open validation requirements. The UI retirement/cleanup was completed separately in [Remotion controls](remotion-retirement.md).

## Preservation, cost and final state

Sixteen comparison exports are saved, including one assembly that adds no inference; four managed Qwen photos and two final reused-video facial passes are retained. The already-paid parents and user drafts were not changed. Private evidence is under ignored `.local/remotion-research-20261103/`; the sanitized [validation receipt](validation/remotion-identity-20261104.json) records hashes, timing and limits without publishing references, face embeddings or credentials.

The selected rental was used throughout. Compute is estimated at **$0.74** across measured goal intervals through confirmed stops, including setup and idle time, at $0.650667/hour. This is not a final provider invoice. Retained storage continues at approximately **$0.014815/hour**; small media/package transfers are separate. There were no new model downloads or new rentals.

Both final workers were independently confirmed stopped and their downloaded outputs verified. The final stop request returned HTTP 400; a separate provider refresh then confirmed this exact A100 **exited**, intended **stopped**, with `computeStopped: true`. The original five-minute idle preference was restored. No pause success was inferred from the failed request or a missing SSH connection.
