# Remotion shot-preflight evaluation

This is a private, local follow-up to the [face/foreground evaluation](remotion-local-geometry-20261104.md). It does not enable automatic cuts, target tracking, repainting or a new Studio workflow. No model, rental, SSH, download or paid inference was used. The original $2 cap remains binding; the separate extra-10¢ native-comparison question is still unanswered.

## Detection findings

The study uses the installed [FFmpeg scdet filter](https://ffmpeg.org/ffmpeg-filters.html#scdet) and independent HSV/rolling-neighbor probes using the documented [PySceneDetect 0.6.3 detector defaults](https://www.scenedetect.com/docs/0.6.3/api/detectors.html). PySceneDetect was not installed, and its implementation/API parity is not claimed. Thresholds were fixed before the cohort run: scdet 10, content 27, adaptive ratio 3/content floor 15, two neighboring frames and minimum scene length 15. Analysis width 160 is a lightweight sampling choice, not a validated resolution-independent setting.

Five cases cover four underlying source videos; one hand case is repeated on its actual prepared 124-frame stream. They are not five independent quality samples.

| Case | Observed result |
| --- | --- |
| Hand/scene edit | The first new prepared frame is 83. scdet proposes 83 and 84; the fixed HSV probe also fires on continuous hand/head motion around 17–22. The adaptive probe finds 83 and an ambiguous same-scene event at 218. |
| Continuous head turn | No default-detector event in the selected 240-frame source interval. |
| Continuous glasses opening | All three raw methods flag frame 2 despite the reviewed scene/person remaining present. The first two analysis frames are identical. Minimum-length filtering hides the event but can also hide real early edits. |
| Same-room pose montage | Adjacent-frame review identifies abrupt edits at 2, 15, 32 and 49. scdet misses all four, the fixed HSV probe misses 32, and the adaptive probe proposes all four. This is an edited counterexample, not a continuous negative control. |

The original hand source has 257 frames at 25 fps; its 24 fps analysis has 247 frames. Exact resized RGB hashes map all analysis frames to original frames. Analysis/prepared frame 83 maps to original frame 86 at 3.44 seconds; the prepared timestamp is 83/24 seconds. These clocks must not be conflated. A separate seven-frame human review confirms prepared 82→83 as the edit. The new shot opens partly hidden by a foreground arm; frame 84 is clearer.

Twenty-six provenance/clock checks pass, with 29 detector-owned artifacts hashed. Aggregate decode/scoring time is 2.305 seconds on this Mac across the five cases, excluding hashing, probing, contacts and original-frame mapping. This is one local observation, not inference speed or a general latency guarantee.

The scores are useful review candidates. They do not reliably distinguish every hand pass, camera movement, flash or low-contrast cut. Adjacent events are localization uncertainty, not permission to move the cut to a convenient frame. No threshold sweep or automatic approval policy was selected.

## Tested source-clock planning mechanics

A private pure planner imports the actual unchanged `viggleWindows`, `anchorIssue` and `anchoredRun` helpers. Fourteen tests and strict TypeScript checking pass. Tests exercise every shot length from 5 through 720 frames, multiple cut ranges, later references, wrong/stale source bindings and unsupported short shots.

The planner requires separately approved boundaries bound to the exact prepared-source SHA, count and 24 fps clock. Detector candidates alone produce no sampling plan. Every shot requires its own approved photo/source-frame/range binding; a prior-shot binding never silently fills the next shot. Explicit independent approvals may share identical photo bytes, while retaining different appearance and motion scopes.

For the 124-frame example, the mechanics split `[0,83)` and `[83,124)`. Model windows remain inside their own shot. Existing overlap and duplicated directional-anchor sampling are retained, but assembly accepts each original frame and each directional anchor once. No previous-shot appearance or motion anchor is admitted.

Frame 84 is local anchor 1 in the second shot and fails the existing later-reference edge rule. The planner requests review instead of silently choosing another frame. No usable reference photo was inferred or actual-media sampling plan approved. Shots below five frames remain unsupported without merging across a cut or inventing frames; shots above the existing per-shot 720-frame limit likewise remain unsupported. A synthetic 849-frame coverage test does not expand the application's generation-duration limit.

These checks establish planning arithmetic and provenance rules. They do not establish real per-shot inference, identity reset, target selection/reidentification, native continuity, automatic reference repainting or facial quality. The prototype remains outside application registration and defaults. See the [sanitized validation receipt](validation/remotion-shot-preflight-20261104.json); private source images and all rejected/counterexample evidence are preserved locally.
