# Akatz identity adapter with motion guidance

Status: optional local integration/preparation only, on `feat/akatz-motion-comparison`. No weight download, GPU operation, test submission, default change or live deployment is part of this preparation. The prior20-cent comparison is closed; it does not authorize another resume.

## Compatibility and scope

The user asked to add [Akatz Character Swap](https://huggingface.co/akatz-ai/MiniMax-H3-Character-Swap-LoRA) to the current Motion Transfer workflow, then proposed character swap first followed by motion/background transfer. These are distinct experiments: two task adapters in one generation versus two complete generations with a generated intermediate.

V1.5 uses the same Ref2VA model family. Its155,110,792-byte release is pinned by repository revision and publisher LFS SHA256 in `config/openjutsu-models.lock.json`. The publisher's release summary independently lists the same size/hash and rank16. This verifies metadata, not downloaded tensor bytes or actual merged-model behavior. Normal Remotion still selects seven files. Adding the adapter explicitly selects only this one additional weight; the existing loader supports the stack without importing H3 Relay or changing native tools.

The publisher's [tested recipe](https://huggingface.co/akatz-ai/MiniMax-H3-Character-Swap-LoRA/blob/main/examples/README.md) uses Ref2VA INT8, FL2V Turbo8, eight steps, CFG1, `er_sde`/`normal`, original-video native references and a source-backed edit mask. Its Add Guide supplies audio, not the full source-image batch. Our current interaction experiment uses DMAD/six Euler/simple steps, an aligned complete-image guide and an empty video target to allow a different background. Merely loading Akatz is **not a reproduction of the author's complete workflow**.

The first comparison intentionally keeps the current fast recipe fixed and evaluates the adapter's compatibility with it. A failure here cannot establish that the published Akatz recipe is ineffective. No matching Turbo8 or new runtime is downloaded implicitly. The BFS Motion Transfer file already includes training adapterV2; Akatz's training provenance lists a different assistant. We do not insert another training adapter. Independently trained task LoRAs modify shared model weights; combining them is not a guaranteed separation of motion and identity responsibilities.

## Frozen single-pass comparison

`studio/scripts/prepare-akatz-comparison.ts` reads an immutable completed aligned-motion job through read-only SQLite. It verifies source/photo/native-output SHA256, preserves that paid baseline and freezes five requests with unique request keys and compiler graph hashes:

| Arm | Motion task | Akatz task | New rendering needed |
| --- | ---: | ---: | --- |
| Motion control |1 |0 |Reuse the existing native baseline. |
| Combined035 |1 |0.35 |One pass. |
| Combined065 |1 |0.65 |One pass. |
| Combined100 |1 |1 |One pass. |
| Akatz only |0 |1 |One pass with the same aligned guidance. |

All retain the same primary reference, source section, seed, dimensions, existing speed adapter, prompt templates and six steps. Akatz has no new trigger inserted. The mixed strengths are exploratory, not published recommended presets. Realized captions must be captured before claiming a sealed causal comparison. Character-sheet conditioning is deliberately unchanged to avoid confounding this adapter test.

The existing main and Fix Faces graphs remain unchanged when no candidate is selected. Leaving the experimental comparison or deriving a Fix Faces job removes both comparison task adapters while retaining the original speed adapter. Manual model selections without the experimental profile remain explicit and are preserved.

## Both sequential orders

Preparation also records a source-scene Akatz request and two conditional plans:

1. **Character swap → motion/background:** run our source-scene character replacement with Akatz and the existing speed adapter, then use the verified native result as the aligned Motion Transfer source, with the desired reference scene.
2. **Motion/background → character swap:** reuse the existing paid Motion Transfer baseline, then apply the source-scene Akatz route. Its source scene is now the desired generated scene, with identity replacement last.

These use our current compiler, not imported publisher Relay masks or its qualified sampler. The first order could reduce competing source-actor appearance if the initial swap is already accurate. Its errors in identity, mouth motion, hands or timing can become the second pass's guide. The second order puts identity editing last, but can also reinterpret the existing performance. Neither order has a quality pass or a measured speed benefit. Total rendering includes both passes; finishing/upscaling should happen only after the selected final output.

Second-stage templates have `sourceId:null`, so they cannot be submitted directly. After the first stage, verify its native SHA256, expected frame count,24fps and dimensions, then ingest a bound derivative and freeze the materialized request once. Retain the same request key for acknowledgement retries. The helper uses actual native frame counts on the H3 grid, refuses results too short for a second Remotion run and never pads or stretches the intermediate. Preserve all original and intermediate files. Inspect final timing/audio against the original performance; re-encoding a generated guide is not proof of byte-identical original audio.

The prepared73-frame cohort reuses the paid arm-crossing baseline. It requires up to four new single-pass jobs and three additional jobs to compare both sequential orders. Review first-stage quality before admitting its dependent render; do not blindly continue a failed/missing-hand intermediate. No controller or automatic work observer is armed.

## Validation and next admission

Local validation:57 focused Studio tests,25 Python tests, typecheck and isolated server/frontend builds. Eight prepared graphs/templates validate against a saved same-host node registry after allowing media placeholders and only the not-yet-installed Akatz filename. This is structural validation, not live readiness or a weight-load/quality test. Both prodv1 compiler hashes are exact. No vendored OpenJutsu bytes or historical paid graphs were edited.

The model is optional and not downloaded. A proposed next phase is the same retained A6000, at its observed$0.38/hour, with an **additional15-cent maximum**, no new rental/runtime/other weights, serial work and confirmed compute stop afterward. This is a proposal, not authorization. The earlier budget remains closed. Independent provider refresh, live queue/model checks, a bounded lease including boot/transfers/stop and user-work priority remain required at execution time.

Evaluate reference identity/hair after the slap, incoming-hand timing and anatomy, eyes/lips staying behind foreground, source-background leakage, scene consistency and original facial performance. No universal identity lock, foreground protection, perfect combination, long-continuation or360-degree claim follows from loadable LoRAs.

See [the sanitized preparation receipt](validation/akatz-motion-comparison-20261109.json). Private publisher metadata/API graph, frozen requests and sequence templates are under ignored `.local/akatz-motion-20261109/`.
