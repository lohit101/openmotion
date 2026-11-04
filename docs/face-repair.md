# Selective face repair

## Scope and implementation status

The user approved selective repair of completed Remotion videos on 4 November 2026, then explicitly paused this task to pursue a separate Kie API branch. Repair implementation and testing are paused. The first managed v1 comparison failed to change any pixels; this feature has not passed visual validation or the production-completion gates below. Do not continue repair v2 or paid testing without the user's later instruction.

Repair operates on the native Remotion video **before Clarity**. The original remains immutable. Users select one or more faulty intervals, review at most two candidates in motion, and explicitly accept a new revision. Public launch, body/motion regeneration and direct repair of existing upscaled videos are outside this iteration.

## Paused evaluation outcome

The isolated comparison `c2b4b0c0-8faf-4b68-b19b-bd9650f30a9e` used the completed 240-frame v8 parent `3d5ec5d8-505e-4bc0-98c8-ff96c8d4435b`, with two marked intervals and their visible blend handles. One real cancellation was confirmed when the user's Clarity work started. The same saved repair attempt was subsequently resumed; no new Viggle render was required.

The final receipt contains all 240 global frame records. Of 68 frames with positive repair weight, 14 produced facial layers and 54 were conservatively preserved because canonical foreground tracking was unavailable. In the 14 layer-producing frames, the tracking field named `targetVeto` is actually an **allow-permission map**: one means editing is permitted. The v1 repair compositor incorrectly multiplied by `1 - targetVeto`, removing all edit permission on clear frames. Saved diagnostic frames 50–53 show nonzero candidate alpha, an all-one target permission map and no hard foreground pixels. This explains the zero-change result; it does not establish what corrected v2 pictures would look like.

Both boundary and identity candidates finished with **zero changed frames** and `qualified: false`. Acceptance is blocked. Lossless/audio/provenance safeguards passing on an unchanged output are not evidence of improved identity, invisible seams or a successful repair. The required identity and boundary improvements in moving footage remain unmet. The unknown-foreground preservation issue also remains unresolved; it must not be bypassed merely to force edits.

The experiment ran in a separate staging database and preserved the production parents. The production backend was not reloaded for this repair evaluation, and its frontend was restored to the existing baseline. No repair recipe was promoted as a quality improvement. Private evidence is preserved under ignored `.local/face-repair-20261104/`, including the staging job's receipt/checkpoints, `zero-change-diagnostic.json`, `zero-change-tracking-diagnostic.json` and the budget ledger. An independent provider refresh confirmed A100 #58966215 exited/stopped and disconnected at **13:19:47 UTC on 4 November 2026**. The five-minute idle preference was restored. The rate-based new repair-test session estimate is **$0.1767**, within its separate $2 allowance; it excludes unrelated user work and future retained-disk storage and is not a finalized invoice. No new rental or model weights were added.

## Editing contract

Selections use integer, half-open frame ranges `[inFrame, outFrame)`. The timeline shows the marked selection, visible editable blend handles of at most 0.25 seconds on either side, and read-only context. Handles clamp at the clip edges. Overlapping edit permission is normalized before processing; a frame is never corrected twice merely because selections overlap.

The entire timeline stays fixed. Repair must preserve source frame count, dimensions, frame rate, timestamp mapping and original audio. Everything outside the displayed editable ranges is protected. Within those ranges, only admitted face support may change; generated foreground, hair, body and scene pixels stay protected. Hidden or ambiguous faces are retained with a recorded reason.

The lossless RGB master must preserve protected decoded pixels exactly. The playable MP4 has normal video recompression and therefore does not promise byte-identical untouched picture data. Neither output replaces its parent.

## Input and processing contract

An eligible parent has a completed original Remotion result, exact raw animation, prepared motion source, approved identity reference and a supported frame mapping. Internal directional children, images, editor exports and Clarity derivatives are ineligible. Existing Standard finishing families, including the beta eye-finishing route, retain their saved settings rather than silently changing to the latest profile.

Every attempt binds its parent output, raw/source/reference files, original timing, model/profile hashes, calibration and selection. Parent calibration and tracking are inherited through a verified record, never relabelled as child-owned analysis. Missing cache data requires explicit fresh analysis against the actual current pixels. Subtracting compressed raw and finished video is not a face-mask estimator.

The generator reads the original raw animation and source performance. The compositor reads the **finished parent**, so accepted body and scene content is not replaced by raw animation and the finished face is not swapped repeatedly. Generated-video foreground protection applies last. Repair controls ramp through the visible handles; whole-frame dissolves are not a seam solution. Outer handle boundaries retain exact parent frames.

Boundary, identity and eye/expression goals have separate bounded corrective recipes. Repeating unchanged inference is not a repair. Candidate recipes remain unavailable when motion testing has not established an improvement. Existing facial v1–v11 formulas and saved fingerprints remain frozen.

## Queue, recovery and review

Repair uses the existing serialized GPU queue and normal activity notifications. Setup, downloads, native inference and other face operations cannot overlap it. Unknown remote activity remains busy across interrupted/reconnecting jobs and protects the instance from idle pause, model deletion and connection switching.

The worker checkpoints by global parent frame index. Cancellation and reconnection preserve verified frames and never restart Viggle. Downloaded candidate layers/frames can finish assembly offline. Idempotent submissions reuse the same attempt; an explicit retry creates a linked attempt rather than overwriting prior evidence.

Candidate completion means processing finished, not that quality improved. Synchronized Original/Candidate playback loops around the repaired region and both joins. Acceptance publishes the selected revision only after explicit user action. Rejection leaves all earlier versions intact.

## Validation and cost gates

The new test allowance is **$2 total**, separate from the exhausted earlier comparison allowance. Only the existing A100 instance is authorized; no new rental or model download is authorized. Reserve $0.25 for transfer/recovery/shutdown margin. Check the live rate, exact instance, idle state and remaining budget before each bounded batch. The private ledger starts charging at the explicit repair-test lease, excluding unrelated ongoing user work. Count setup, idle time, transfer and stop confirmation inside that lease.

Freeze fixture identities, input hashes and selected frame ranges before tuning. Evaluate frontal speech, hand occlusion and head movement, including a held-out clip. Review both entry and exit joins in motion for identity, expression timing, teeth/jaw integrity, boundary flicker, sharpness and colour. Diagnostics do not establish identity accuracy or universal quality.

Required nonvisual checks include disjoint/overlapping ranges, start/end/one-frame selections, missing or tampered inputs/caches, ambiguous faces, cancellation/reconnect, queue/idle guards, exact protected pixels in the master, unchanged clock and audio, and immutable parent provenance. At least one identity correction and one boundary correction must improve real moving footage before this feature can be marked complete.

Current evidence is tracked in [the validation record](validation/face-repair-20261104.json). Quality validation and production deployment are unfinished and paused.
