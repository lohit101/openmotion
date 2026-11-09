# Source facial guide comparison

The user requested testing clearer source facial cues with the existing OpenJutsu/H3 models before trying new LoRAs. The pause was explicitly lifted on 2026-11-09. This evaluation is separate from the older paused selective face-repair task and its exhausted allowance.

Two explicit, optional API profiles restore the copied native SAM face track into `H3GreyMannequins` while keeping source audio enabled. `source-face-guide-v1` uses the native face-blur fraction 0.05; `source-face-detail-v1` uses 0.015. Each profile is frozen. The guide remains grey, and the existing person mask and scene mode stay in control. No profile field means the original graph is unchanged. No source-face pixels are composited into the final video. Existing Fix Faces math is unchanged.

The backend accepts the optional `settings.sourceFaceGuide`; there is no general selection menu or changed default. Reusing an experimental result shows a notice and a way to return to the original guide. Turning on No lip-sync clears the experimental audio-enabled guide. Module download plans and model weights are unchanged.

Three matched requests were frozen before the paid phase: same source/photo, seed 1729, six steps, current DMAD strength 1, Euler/simple, shifts 12/2, 480p, motion768, a five-second request and 24fps native export. All produced 107 frames / 4.458333 seconds on the native frame grid. RIFE, Clarity and Fix Faces were excluded. Both vision describers use sampling off; the prompt templates and graph settings stayed identical apart from the facial-guide nodes/blur and per-job media/cache identities. The realized generated captions were not independently archived, so this is not a sealed text-conditioning causal benchmark.

| Arm | Application processing time | Observation |
| --- | --- | --- |
| A: original guide | 139.537s | Opening closed eyes are missed; several puckered/open-mouth shapes differ from the source. |
| B: native facial cues | 151.435s | Some mouth shapes follow the source more closely, including the opening around 0.67s. Opening eyelids and later blink behavior remain imperfect. |
| C: clearer facial cues | 157.448s | Similar mouth benefit; no decisive additional gaze/blink improvement over B. |

These single-run times include application preparation, native work and saving; user work was interleaved between A and B. They are not a warmed, repeated sampling benchmark. The indicative allocation is about $0.04733 at the saved $0.38/hour total rate using only the three jobs' processing times, excluding unrelated user work and ongoing storage; this is not a provider invoice.

All three native exports have identical dimensions, frame counts and frame rate. All 193 AAC packet payload hashes and timestamps match across the three exports. Fixed diagnostic crops and frame contacts were reviewed; the source opening and hand/head-turn sequence remain visibly imperfect. No direct native-player playback review or general identity, lip-sync, gaze, occlusion or temporal quality pass is claimed. This hand-compression/turn clip does not establish phoneme timing on spoken dialogue. The supplied character photo also has closed eyes.

The result supports a limited mouth-motion benefit, not a complete explanation of the earlier realism problems. Neither candidate is promoted as the default. Normal production remains at the user-defined [prodv1 checkpoint](checkpoints/prodv1.md). The three paid originals and a labelled four-column review MP4 are retained under ignored `.local/face-guide-20261109/`, with independent Library records and immutable input/graph hashes.

Validation includes 44 focused Studio checks, three Library checks, typecheck, server/frontend builds, three unchanged legacy graph fixtures, the recorded prodv1 graph comparison, actual live node-schema preflight and ten CPU checks using the pinned native grey-guide implementation. The CPU masks were synthetic: their exact outside-guide/fallback checks do not certify real hand detection or protected pixels in generated video. A guarded backend reload preserved 65 jobs/65 assets/five protected settings. The later static-only update retained all 69 jobs/66 assets and old frontend assets without another restart. No GPU rental, compute resume, new weights or remote runtime installation was performed for this comparison.

After the renders, the normal five-minute idle policy paused compute. An independent provider refresh at 09:21:23 UTC confirms #59859991 exited/stopped, disconnected, with no active jobs/setup; retained storage continues separately. No additional test or resume is armed.

The user separately asked why new hands/objects disappear in reference-scene motion transfer. Current reference-scene preparation neutralizes the surroundings, its motion describer omits other people/props, its prompt excludes source-video objects, and its target has no source pixels to preserve. This is a conditioning/edit-region limitation; higher resolution does not restore omitted cues. Interaction-aware guides and protected foreground/background editing were discussed only. No such workflow or prompt change was implemented.

See [the sanitized validation receipt](validation/source-face-guide-20261109.json). The prodv1 tag was created before committing this experimental feature and must never be moved to include it.
