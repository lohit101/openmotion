# Incoming interactions in reference-scene Remotion

Status on 2026-11-09: local evaluation implementation and bounded comparison inputs are ready; no new inference or visual improvement is established. Branch `feat/remotion-interactions` is separate from the immutable `prodv1` checkpoint. The running backend and normal draft remain unchanged.

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

[BFS Motion Transfer v1.0](https://huggingface.co/Alissonerdx/Minimax-H3-ComfyUI/blob/main/docs/motion-transfer.md) is the closest task match found. Its published examples support guide performances with people, objects and multiple explicitly assigned references. The pinned merged file includes training adapter V2; do not add that adapter again. It reuses our Ref2VA base and adds **184,840,504 bytes** (about 185 MB / 176 MiB). Metadata, revision and publisher LFS SHA256 are in `config/openjutsu-models.lock.json`; no weights were downloaded. Normal seven-file Remotion plans remain unchanged. Selection/Generate never download it implicitly.

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

Provider refresh confirms the same A6000 is stopped, with the normal five-minute idle policy. The user subsequently approved a separate $0.20 cap and resumed this same A6000. GPU validation and the explicit task-weight download are now authorized but were not executed at this preparation checkpoint. No agent resume, rental, installation, model transfer or paid inference occurred during preparation. The earlier paused selective face-repair work remains paused.

See [the sanitized receipt](validation/remotion-source-interactions-20261109.json). Private research, source contacts, graph/request manifests and interface receipts are under ignored `.local/remotion-interactions-20261109/`.
