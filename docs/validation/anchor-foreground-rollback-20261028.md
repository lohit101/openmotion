# Later-reference and foreground experiments — reverted

The user rejected the visual quality and requested restoring the previous workflow and pausing compute on 2026-10-28. All uncommitted application, workflow, runtime-manifest and UI changes from this experiment were removed. The production app was rebuilt from `dfa18bd` and reloaded. Its previous Remotion workflow, existing face tools and five-minute idle pause remain intact. The motion draft was restored from the last user-completed run `f4981578-1dfc-42de-b0c7-2fec1e9bc261`.

Do not continue these experiments or resume compute automatically. The user wants to return home and research the next approach first.

## What was observed

All tests used the existing RTX A6000 rental, one GPU at a time, at its saved $0.40/hour compute rate. Times below have different scopes and are not interchangeable.

| Test | Run | Recorded time | Result |
| --- | --- | --- | --- |
| Native any-frame reference, 73 frames, 480 × 864, five Euler updates | `25c5f518-e55a-463e-a770-e19ed77cb7aa` | 73.084 s Studio end to end | Delayed gestures, invented sleeve, doubled/incorrect fingers, facial artifacts. Failed. |
| Same inputs/settings with a full-frame native H3 timed guide | `274e2a2f-fa68-4e10-a506-a29f4dbdea58` | 61.963 s Studio end to end | Face closer to reference, but suppressed source motion and hand gesture. Failed. |
| Existing source-performance face pass on the native-reference output | `27deef15-2687-4907-97da-09095ae1b644` | 21.232 s remote processing, excludes transport | Artificial facial detail; cannot repair invented hands. Failed overall. |
| SAM2 source-hand tracking and original-pixel restoration after face swap | `76d7660f-2692-40ef-bad5-48f313f0e2f3` | 7.425 s remote processing, excludes transport | Tracked the real hand/forearm, but left Viggle's invented foreground elsewhere, producing double hands. Failed overall. |
| Rear-facing opening with a later reference, using an explicitly reversed 73-frame diagnostic source | `6c793ce1-ae31-4f21-8fa3-637d7624849b` | 70.119 s Studio end to end | Render completed; no visual quality pass was established before the user cancelled the work. |

Synchronized source/output frames and the SAM2 mask were inspected. No output passed the user's realism requirement. No latent foreground-pinning or generated-object-removal experiment was implemented or submitted. Do not describe the source-mask pass as a hand repair: preserving a real occluder does not remove a displaced or invented generated occluder.

The five experimental runs were moved to Library Trash without deleting their media or changing paid conditioning. Existing user originals were preserved. Removed experimental source files and patches are archived in ignored `backups/anchor-evaluation-20261028/rolled-back-code/`.

## Setup and cost

An optional Apache-2.0 [SAM2.1 Small checkpoint](https://huggingface.co/facebook/sam2.1-hiera-small) (184,416,285 bytes) and a separate runtime were installed. A slow laptop upload was stopped in favor of direct host downloading; the second setup attempt completed in 33.678 seconds. Neither runtime nor checkpoint is connected to the restored workflow. Cached experimental files remain on the paused disk; compute was not resumed to remove them. Existing generation models were never deleted or replaced.

Observed start-request to stop-confirmation intervals totalled approximately 25.65 minutes across two sessions. At the saved tariff this corresponds to approximately **$0.171 compute**, plus approximately **$0.015 retained storage across the roughly 51-minute observation period**, and small transfer charges (under one cent for these new small files and videos). This is a tariff-based estimate of approximately **19 cents**, not a retrieved Vast invoice; provider billing timestamps and transfer accounting may differ.

## Rollback verification

- `npm run build --prefix studio` passed after restoring the previous code.
- Rebuilt app reloaded with the previous user inputs/settings; experimental frame-position fields were removed from the draft.
- No running/queued/reconnecting Studio jobs remained.
- Vast's independent instance response reported `actual_status: exited`, `intended_status: stopped`, `cur_state: stopped`.
- Recast's refreshed instance state also confirmed `computeStopped: true`.
- Storage and original user media/models were retained. No further paid work is authorized by this cancelled experiment.
