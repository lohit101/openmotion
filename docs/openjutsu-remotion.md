# Remotion with OpenJutsu Simple

The `feat/openjutsu-remotion` branch replaces the new Remotion creation screen with the user's Desktop OpenJutsu **Simple** motion-transfer workflow. It imports the real graph and its TypeScript graph builders, rather than approximating them with the old Viggle pipeline. Kie and the separate Wan prototype are unchanged.

## Start the full app

Run `bash scripts/openjutsu-studio.sh` from this worktree, then open **http://127.0.0.1:3003**. The tab is titled **Recast · OpenJutsu**. The launcher starts the normal application entry point, including SSH reconnection, managed GPU rental/setup, recovery, compute-stop monitoring and the saved five-minute idle policy. It preserves an existing `studio/data/openjutsu-preview` database and media; a fresh installation uses `studio/data/openjutsu`. Explicit `PORT` and `RECAST_DATA` values take precedence. The original app and Kie worktrees have separate processes and data.

The old private preview harness disabled SSH restoration and background monitoring for its read-only integration review. It is not the rental launcher. Starting the normal app does not itself rent/resume compute or download weights.

The first managed Remotion rental attempt was blocked before creation by the legacy local reference-framing prerequisite. OpenJutsu consumes the original media on the GPU, so this CPU geometry tool is unnecessary for its pipeline. The native profile now reaches the configuration check, initial rental, existing-rental setup retry and actual deployment worker. Local tools, SSH-key authentication, deployment manifests, loopback-port ownership and exact rental prices/fees remain checked. Other workflow selections retain their original geometry prerequisite. A failed preflight with no creation attempt has no instance to stop; select a fresh offer and deliberately launch it after checking configuration.

Verified terminal native failure receipts can also be reconciled through the normal HTTP resume endpoint while offline. Their job, graph hash and prompt must match; unrelated receipts remain rejected. This records the existing failure without requesting GPU work. Saved native-file recovery retains its existing integrity checks.

See the [rental repair receipt](validation/openjutsu-rental-20261107.json) for local regression checks, live preflight and preservation results. An actual new paid rental/setup is not part of this validation.

## Recovered configuration

The requested browser origin supplied saved preferences and five recent-job entries. ComfyUI's current history was empty, so it was not used to infer defaults. Three completed MP4s still contained their native graph metadata. Those graphs corroborate the model, sampler, adapter, motion and seed settings below. The latest selection was 0–6 seconds with a 15-second segment limit; the earlier two runs used a six-second limit.

| Control | Imported value |
|---|---|
| Resolution | 480p, native 24 fps |
| Model | General MiniMax H3 Ref2VA INT8 ConvRot, **not the Viggle checkpoint** |
| Sampling | 6 steps, Euler, video shift 12 / audio shift 2 |
| LoRA | DMAD rank 39, strength 1 |
| Motion guidance | 512px long edge |
| Seed | 0 |
| Segment limit | 15 seconds |
| No lip-sync | Off |
| Tracking | Person, normal margin, hat fix off |
| Scene | Source video |
| Acceleration | None |

The saved preferences predate OpenJutsu's `referenceScene` setting. Importing them as `false` preserves their actual source-scene behavior. Choosing **Character image · motion only from video** explicitly activates the copied newer Desktop variant: appearance, outfit, setting and aspect ratio come from the image, and performance comes from the video. This variant passed schema/readiness checks, but is not one of the three historical rendered comparisons.

Global OpenJutsu face-style/detail/tone preferences are not part of its Simple graph. They are not silently attached here. New Remotion jobs have no automatic PerformRecast, FaceFusion, Imagen repaint or old Viggle finishing stage.

## What is copied

`studio/vendor/openjutsu/` contains the Simple API graph, `simple.ts`, `model.ts`, the imported utility dependency `advanced.ts`, the MIT licence and exact file hashes. The source was the user's requested Desktop working tree based on `7fe118b`, including local changes; it is not represented as a pristine upstream release. The original project was not edited.

For all three recovered source-scene runs, the wrapper produces the same 59 nodes and input values after normalizing uploaded filenames, ComfyUI's `is_changed` cache fields and the planner's resolved-runtime annotation. The submitted Recast graph adds one string-concatenation node to give every job its own cache/output namespace. It leaves the model, prompts, sampler and context settings intact. The wrapper also preserves OpenJutsu's silent-video compatibility adapter and original section selection behavior.

The first user run with reference-scene mode and an extra model adapter exposed a 103-character internal name, exceeding upstream's 96-character limit. New jobs use only a bounded Recast job identity for both the chain and assembled output; picture/scene/model suffixes are not appended to it. This changes file/cache identity, not conditioning or sampling. Terminal native errors retain their full failure receipt and become Failed with a concise cause, rather than appearing resumable. Reuse the saved settings to create a corrected job; the failed graph is preserved and is never silently resubmitted. See the [failure/fix receipt](validation/openjutsu-run-name-fix-20261107.json).

The core and four required node packs are pinned to the revisions observed on the working host in `config/openjutsu-runtime.lock.json`. The branch's managed ComfyUI pin matches that core. Spectrum remains optional and is selectable only when its node is already available and speed LoRAs are disabled.

## Inputs, downloads and results

The new screen has a separate autosaved draft, video/image drops and Library selectors, trimming, whole-video selection, scene source, quality and the native advanced controls. The imported settings can be restored without removing either input. Existing Recast layout, unified module downloads, processing view, player, Library and alerts are reused. Old paid jobs retain their stored graphs/settings and recovery route; reusing their media for a new OpenJutsu video is explicit.

The seven default dependencies total **51,162,804,168 bytes (51.16 GB decimal)**. Four new catalog entries total 36.89 GB; the video VAE, SAM 3.1 and 8B visual encoder reuse existing pins. They are counted once. These are model bytes, not the complete disk requirement: rental filtering adds runtime/media reserves. The old Viggle model and facial-finishing weights are unnecessary for a new Simple run.

On an already-connected managed GPU, **Download Remotion** restores only missing selected dependencies and explicitly prepares the pinned native tools if needed. It never starts/resumes compute. Setup observes the same detached attempt after reconnection, refuses busy/unknown queues, protects existing changed node trees and only restarts a Recast-managed engine. The already-working external OpenJutsu engine needs no installation when its compatible nodes and model choices are present.

Physical inventory and the file browser can recognize the active ComfyUI installation beneath the existing workspace. Explicit catalog deletion still uses the descriptor/link/queue protections. Native weights are registered in the active loader paths after an explicit download; existing same-name files are not overwritten. Model weights, references and generated media are never committed.

Each run freezes input hashes, native settings, source section, graph hash and original engine endpoint/rental. Original media is uploaded without the previous reference-preparation stage. Submission is idempotent; an acknowledgement lost after sending remains unresolved and is searched by this job's ownership marker before any retry. A connection change during admission or execution cannot submit that run on another engine.

The successful native history is saved **before** output transfer. Recovery reads only the final assembly node, including its real `images` video descriptor. Download failures reuse the paid result. Once the native file is saved and hashed, playback preparation can finish offline. No additional video encode or face pass is performed. Actual native frame counts, dimensions and duration replace estimates in the saved result.

OpenJutsu rounds sections to H3's native frame grid. The recovered 6-second selection produced 141 frames / 5.875 seconds; the complete 9.041667-second source produced 209 frames / 8.708333 seconds. This integration does not secretly pad or retime them to the requested length.

## Validation and limits

See the [sanitized receipt](validation/openjutsu-remotion-20261107.json). Checks cover all three real saved graphs, exact copied bytes, selected-only/shared files, native dynamic-input validation, input/engine ownership, request deduplication, missing acknowledgements, saved-history transfer recovery and byte-identical native export, including offline local finishing. Local synthetic media is used for runner tests.

Read-only checks against the existing OpenJutsu engine found both scene graphs compatible, all seven selected files available and an idle native queue. Native Chrome verified advanced values, scene switching, seven-of-seven download readiness and an enabled Generate action in the separate local preview. No Generate action was clicked. The main GPU and Kie app processes were preserved.

No GPU inference, model download, remote install, compute resume/rental/stop or new quality/speed benchmark was performed for this integration. Graph parity is not a guarantee of identical sampled pixels, a general occlusion/cut/identity pass or Higgsfield parity. A new output comparison remains a separate GPU validation step. OpenJutsu's MIT licence covers the copied application code; the H3, encoder, SAM and adapter model terms remain separate. The manifests do not assert commercial hosted-service clearance or uncensored behavior.
