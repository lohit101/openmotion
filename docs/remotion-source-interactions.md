# Incoming interactions in reference-scene Remotion

Status on 2026-11-09: eight bounded A6000 comparisons are complete and saved. Aligned guidance plus Motion Transfer is the strongest candidate on these two clips, but is not a production/default promotion or an all-situations quality pass. Branch `feat/remotion-interactions` is separate from the immutable `prodv1` checkpoint. Optional API admission/reuse notices are deployed; the normal draft and its generation graph remain unchanged.

## Why the current reference-scene path drops hands

The copied reference-scene variant sends a neutral-background `H3GreyMannequins` video. Pixels outside the main person are replaced by flat grey. Its shot instructions omit other people and props, and its generation prompt explicitly excludes source-video objects. Its empty target has no source pixels to preserve. This removes evidence of incoming arms, bystanders and objects before H3 sees them. Higher motion/output resolution cannot recover that intentionally removed information.

Source-scene character replacement has different semantics: its source-backed masked target can preserve scene pixels outside the edit. That behavior is not automatically present when regenerating both person and background. A source-only foreground overlay is also not a proven solution: misregistration and invented generated hands can create doubled limbs. No overlay or final source-face paste is added here.

## One-pass candidates

Two optional API-only `settings.interactionGuide` recipes are versioned independently. There is no new default or general workflow menu. Existing inputs, sampler, source clock, image role, output dimensions, native assembly and audio protection remain.

| Profile | Complete performance input | Purpose |
| --- | --- | --- |
| Absent | Original neutral mannequin | Exact production control. |
| `reference-interactions-v1` | Complete source RGB batch as the native video reference, paired with its source audio | Restore incoming-interaction evidence with existing weights. |
| `aligned-interactions-v1` | Complete source RGB/audio through native `MiniMaxH3AddGuide` at frame zero; no simultaneous native full-video reference | Evaluate the published aligned-guide route, with and without its task adapter. |

Both candidates retain the native planner's performer mapping in the shot describer instead of asking it to describe only a generic main person. The prompt assigns replacement identity, hair, outfit and setting to Picture 1; source performance, incoming people/objects and occlusion order belong to the guide. It explicitly keeps bystanders separate and describes a back view as a back view. These are conditioning instructions, **not a tracked identity guarantee or an exact foreground mask**.

The aligned profile is intentionally limited to one explicit section of at most five seconds, contained within one native segment. Combining a full source-guide anchor and carried generated history requires a separate continuation comparison. Audio-disabled and experimental facial-guide combinations are rejected for this initial study. Standalone graph exports get distinct cache suffixes; Studio retains its unique per-job namespace. Reuse shows an experimental notice. Leaving the comparison removes only its profile and specific motion task adapter. Fix Faces does not inherit that task adapter or guide.

## LoRA assessment

[BFS Motion Transfer v1.0](https://huggingface.co/Alissonerdx/Minimax-H3-ComfyUI/blob/main/docs/motion-transfer.md) is the closest task match found. Its published examples support guide performances with people, objects and multiple explicitly assigned references. The pinned merged file includes training adapter V2; do not add that adapter again. It reuses our Ref2VA base and adds **184,840,504 bytes** (about 185 MB / 176 MiB). Metadata, revision and publisher LFS SHA256 are in `config/openjutsu-models.lock.json`; the explicitly approved file was downloaded once and independently matched by size and SHA256 on the host. Normal seven-file Remotion plans remain unchanged. Selection/Generate never download it implicitly.

The prepared comparison uses our existing compressed DMAD at six Euler/simple steps in all arms. The publisher's Guide Latents example uses DMD8/Euler/simple at eight steps, with different encoder/VAE precision. Our test is therefore a bounded compatibility/quality experiment, not a reproduction of the publisher recipe. An unsuccessful six-step test would not disprove that recipe. LoRA loading and guide encoding can add time, but neither candidate adds a second video diffusion pass; actual end-to-end speed is unmeasured.

[TARA](https://github.com/alisson-anjos/Henge/blob/main/docs/conditioning.md) supplies explicit temporal alignment to native reference tokens. It requires a matching task adapter plus BFS nodes; its fast Kitchen path additionally requires a modified temporal kernel. It is deferred to avoid changing the accepted runtime and attention implementation before the simpler test. [SolarRenderer](https://huggingface.co/Enderfga/SolarRenderer) is another relevant structure/first-frame route, but needs its own control/few-step pair and conditioning; it is not silently stacked onto DMAD. [Akatz V1.5](https://huggingface.co/akatz-ai/MiniMax-H3-Character-Swap-LoRA) is aimed at source-scene character swaps and still reports possible occlusion/timing/identity drift. A realism adapter alone does not restore missing guide pixels or establish object ownership.

The BFS task weights allow local/internal media creation, including selling output media, but prohibit offering their functionality as a hosted API/SaaS/remote model service. Larger commercial organizations also have an attribution requirement. The H3 base and merged training adapter retain their own terms. This candidate must not be treated as cleared for a future hosted Recast service. See the publisher's [motion-transfer license](https://huggingface.co/Alissonerdx/Minimax-H3-ComfyUI/blob/main/LICENSE_MOTION_TRANSFER.md).

## Prepared validation

The offline, read-only CLI is:

```sh
cd studio
node_modules/.bin/tsx scripts/prepare-source-interactions.ts \
  data/openjutsu-preview/studio.sqlite COMPLETED_PARENT_ID NEW_OUTPUT_FOLDER
```

It verifies immutable parent media hashes, requires matching source/reference framing for this study, freezes request IDs and graph hashes, and writes a new directory without changing drafts, jobs, media or compute. The requests must be submitted through the normal application admission path after explicit authorization; no observer or controller is armed.

Two existing clips have four prepared arms each: original, complete native reference, aligned control, and aligned plus task LoRA. The first includes an incoming arm that crosses the face and fills much of the camera view; it yields 73 native frames. The second has repeated externally driven cheek/hand contacts and head movement; it yields 107 frames. The two aligned arms use the same prompt templates, seed, six steps, DMAD and dimensions; only the optional task adapter/model cache identity differs. Generated captions must also be archived before making a strict causal comparison. RIFE, Clarity and face finishing are excluded so they cannot hide base defects.

Acceptance requires synchronized source/output review for entry/exit timing, contact, missing/doubled hands, facial features over foreground objects, stable head scale/identity, source appearance/background leakage and motion fidelity. Inspect the native video and boundary frames, not only isolated favorable stills. Re-check any selected result after finishing. A successful arm-crossing clip does not certify walk-bys, arbitrary objects, cuts or a complete turn.

Six additional existing sources were sampled locally. This review did not establish a suitable complete 360-degree turn or a person walking fully across the subject. Those remain held-out validation requirements. Exact unseen back-view hairstyle/clothing also needs suitable views of the intended character; a front-only photo cannot specify them. Additional character references are not implemented by this change. No universal “all situations” or production-quality claim is made.

Offline results: 60 focused Studio checks, 25 Python checks, typecheck and isolated server/frontend builds passed. Eight graphs pass the saved same-host native schema after allowing only media placeholders and the not-yet-installed LoRA choice; this is not a new live GPU readiness check. Thirteen CPU interface checks execute the pinned native AddGuide method with native frame constants and synthetic pixel/time markers; VAE/audio encoders and same-size resize/conditioning interfaces are substituted. They verify guide delivery and clock bounds, not learned-video quality or real hand protection. Both prodv1 graph hashes remain exact.

A generic npm build briefly replaced the local frontend assets before failing on an unsupported flag. The previous saved frontend index/assets were restored and verified over HTTP, without restarting the backend or changing jobs/settings. Subsequent builds use explicit isolated output paths. No intentional candidate deployment was performed.

The user approved a separate $0.20 cap and resumed this same A6000. The eight comparison jobs ran serially with one explicit185MB task-weight download, no new rental, no agent compute resume and no remote runtime upgrade. The earlier paused selective face-repair work remains paused. Final independent provider refresh confirms the same host exited/stopped at11:27:30UTC with the normal five-minute idle preference enabled.

See [the sanitized receipt](validation/remotion-source-interactions-20261109.json). Private research, source contacts, graph/request manifests and interface receipts are under ignored `.local/remotion-interactions-20261109/`.

## Executed results and limits

All eight native histories report success and match the corresponding frozen application graphs. All720 decoded frames are present at480×864/24fps. Within each cohort, every AAC payload hash and packet timestamp matches across all four arms (packet counts are in the receipt). Native MP4s and hash-bound histories remain in the Library; labelled review MP4s are separate local re-encodes.

| Route | Arm crossing:73 frames | Cheek contact:107 frames | Observed result |
| --- | ---: | ---: | --- |
| Original guide |148.095s |135.360s |Keeps the reference appearance/scene, but loses the near-camera crossing hand; several cheek-driven mouth/eyelid shapes differ. |
| Complete native reference |79.102s |115.481s |Restores interactions and several mouth shapes; the distinct-room clip returns to the source person/curtains. Rejected as the general replacement. |
| Aligned control, no task adapter |83.151s |117.496s |Strong source motion, but returns substantially to the original performer/scene. Rejected. |
| Aligned + Motion Transfer |80.973s |116.415s |Keeps the crossing hand and the reference room; more closely follows several cheek-driven puckers/eyelids while keeping more reference appearance than the aligned control. Strongest candidate, with residual identity/hair variation after turns. |

Times are application preparation/native work/saving for one short job each, with model/cache differences; the first control includes cold preparation. They do not establish a2× speedup. In the two already-warm aligned pairs, adding the task adapter caused no material observed latency increase, but this is not a repeated performance benchmark. No upscaler or face finishing was part of these eight jobs. The user separately ran Fix Faces afterward; that output is not one of the comparison arms.

Synchronized contacts, a consecutive17-frame hand-crossing detail strip and native-player comparison playback were reviewed. The arm-crossing comparison reached its end in QuickTime; cheek-contact playback opened and started, but a complete native-player pass of that comparison is not established. This is not an independent full-quality/identity/temporal pass on every frame. The new guide regenerates hands instead of preserving their exact original pixels. Foreground details can change, and prompts do not establish a visibility ceiling for every object. Neither a complete360-degree turn nor a full walk-by was tested. Longer aligned continuation remains deliberately blocked.

A guarded idle backend reload preserved69 existing jobs/66 assets/five protected settings and unrelated app processes. Static assets retain previous versions. After the tests all69 original job records still match. The normal Remotion draft, idle preference and prodv1 graph/tag/branch remain unchanged. The separately used Fix Faces draft changed through ongoing application use and was preserved. A final notice clarifies the five-second experimental section limit.

The test interval was1157.530s, with876.073s summed job-processing time. Its conservative allocation is about$0.12811 including the adapter's maximum permitted ingress and a small transfer reserve. A separate Fix Faces module setup and user Face Fix job began after the last comparison; the initial stop guard correctly refused to interrupt that work. After it completed, queues were rechecked empty and compute was stopped. Counting the entire1484.869-second connected interval, including that separate work, at the observed$0.38/hour plus a$0.02 transfer reserve gives a conservative **$0.17674 / $0.20** allocation. This is an estimate/reserve, not a provider invoice; retained disk billing continues separately after the confirmed stop. No test controller or automatic resume is armed. Further paid evaluation needs a new bounded authorization; do not restart under the small remaining reserve.
