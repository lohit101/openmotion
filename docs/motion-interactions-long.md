# Incoming interactions for longer clips

The user explicitly requested long-clip support on2026-11-09 after the initial UI integration. New selections now use `aligned-interactions-v2`, with no five-second output-selection cap. The existing native segment limit still bounds each model call; a longer selection or Use whole video is handled by the normal recursive plan, overlap trimming, saved checkpoints and original soundtrack assembly. No model weights, sampler steps, resolution, segment limit or extra finishing pass are changed by enabling this guide.

## Continuation correction

Simply removing the old length guard would lose the full performance guide after segment one. The pinned Context Loop's `_drop_prefix_guides` discards any guide anchored inside the protected prefix. A source guide anchored at frame zero is removed as a complete record, including its future frames. This was reproduced using the actual pinned method.

V2 attaches the native Add Guide **after** Chain Context. It reads that iteration's current source image batch and synchronized source audio, using the context node's conditioning and target latent. BasicGuider uses the resulting conditioning; the sampler still receives the native masked target from Chain Context. The copied predecessor video/audio prefix and its zero-denoise mask stay intact. Current-shot source slicing, overlap offsets, trim, save and final assembly retain their original links. The graph admits only the existing Hard picture + protected audio handoff for this profile.

V1 remains frozen, including its five-second/single-window guard and original guide order. Its historical graphs, prepared comparisons and paid results are unchanged. V2 gets its own standalone cache suffix; Studio retains unique job namespaces. Absent profiles and both `prodv1` graph hashes remain exact. The Akatz preparation/paid-test request is unrelated and has not been deployed or executed.

The editable saved v1 draft upgrades its profile flag when the refreshed UI loads. Source/reference, start, selected length, segment limit and adapters remain unchanged. Historical result reuse stays exact and offers an explicit Enable longer clips action. New reference-scene selections turn V2 on automatically. Adapter validation, downloads, source-scene behavior, No lip-sync and Fix Faces isolation remain.

## Evidence and deployment

The working branch passes54 focused Studio checks; the isolated live-base build passes48 checks, typecheck and server/frontend builds. Fifteen long/whole-selection graphs validate against the saved same-host registry, with only media placeholders admitted. The host was offline during this check; it is not a new readiness or model-load test. Eight existing prepared graphs/templates and both checkpoint hashes also verify unchanged.

A separate CPU audit executes the pinned AddGuide and masked-prefix methods with real Torch tensors:80 assertions over12 synthetic windows cover73/107/141/362 raw-frame sizes. It reproduces the old guide deletion, confirms the new full source window reaches the encoder in every provided window, checks exact copied video/audio latent tails and masks, and verifies that adding the guide does not mutate the masked target, predecessor or original target. Neural encoders, nested wrappers and the CUDA-availability check are substituted. These are interface/integrity checks, not learned motion, identity, foreground protection, source-planner or temporal video-quality evidence.

Guarded local deployment found the exact retained instance independently exited/stopped under the existing idle policy and all local queues idle. It reloaded only the owned Studio process, preserving all95 job records,88 assets and five draft/settings values, plus both other applications and previous frontend assets. The new live API accepts V2 before rejecting a deliberately media-less validation request; it created no job. The actual workspace bundle is verified over HTTP. No GPU power operation, remote installation, model transfer, inference or forced browser reload occurred. Compute was not resumed for this task.

Long-clip visual quality, identity after repeated turns and actual foreground fidelity remain for user validation. No speed benchmark, flawless boundary claim or full quality pass is established. The new guidance regenerates interactions; it does not paste exact source foreground pixels. Private pinned-source/audit/build/deployment evidence stays ignored under `.local/motion-interactions-long-20261109/`.
