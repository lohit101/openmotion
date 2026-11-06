# Character reference packs for Kie Remotion

This feature is local to the Kie-only app (`feat/kie-character-swap`). It stores named characters with a neutral facial identity anchor and labelled face/body angles, expressions and optional whole sheets. It uses the existing Wan 3.0 reference-image API, without a new GPU, weights, LoRA, post-process or image-generation call.

## Using it

Open **Remotion → Inputs → Character → Manage characters**. Name a character and upload an individual image or a reference sheet. You can also choose an image already uploaded to this installation. Add the whole image, or crop one panel. Keep the original sheet selected to crop more panels without uploading it again. Set each reference's role, angle and expression; choose one neutral face as **Identity anchor**. Save the pack.

Back in Remotion, select the saved character, then expand **Choose reference views**. A new selection starts with the facial anchor only. Choose relevant references individually or use Face only / Angles / Angles + expressions / Whole sheets as convenient selection sets. Sets that exceed eight extras are refused with a message rather than silently dropping images. Up/down controls set the exact extra-image order. A pack can retain up to 32 references; a video sends at most ten images: Image1, the facial anchor as Image2 and up to eight extras.

Image1 is still required: it is the scene-ready character image providing hair, body proportions, outfit, accessories, lighting, background and framing. The saved character supplies facial identity and complementary views, not an automatic first-frame repaint. A body view is scoped to unseen appearance compatible with Image1. Expression references explain how the same character looks smiling, speaking or blinking; Video1 continues to supply expression timing, intensity, gaze and mouth movement. The prompt explicitly allows the neutral facial anchor to deform naturally.

**Review inputs & prompt** shows the ordered references, selected source interval and complete prompt, including additional user instructions. No files are sent to Kie until the user presses Generate. **Manual uploads** retains the existing main image, optional facial reference and extra-view route; switching from a pack retains its selected images as manual references.

Archive hides a character from new selections and can be reversed by enabling Show archived in the manager. It does not delete assets, revisions or paid jobs. Saving an edited pack does not silently update the current generation draft. **Load latest revision** explicitly updates it, retaining still-available selected view IDs. Characters and media are stored in this installation's data folder; Git contains no personal packs or photos, and pulling the branch on another laptop does not transfer those files.

## Research and limits

The official [Alibaba Wan 3.0 prompt guide](https://help.aliyun.com/en/model-studio/wan3-video-generation-prompt-guide) demonstrates separate appearance and facial-expression references, and motion/expression guidance from a video. Its reference mode is distinct from start/end-frame mode. [Kie's current API](https://docs.kie.ai/market/wan/3-0-video) accepts up to ten ordered reference images. The exposed endpoint does not offer a trained identity embedding, facial rig, reference weights or custom character LoRA. These controls are prompt instructions, not deterministic identity locks.

Two public workflow approaches informed the UI. [FilmSpark's actor turnaround workflow](https://filmspark.ai/guide#turnarounds-actors-only) supports both complete sheets and separate views in a reusable actor library. [Magnific's hands-on guide](https://www.magnific.com/blog/wan-3-0-prompt-guide/) scopes a sheet to character appearance while assigning other scene roles separately. These are provider/creator demonstrations, not controlled comparisons of this application's source-driven swap.

A creator's [sheet example](https://www.reddit.com/r/Akool_Official/comments/1w9wyxk/prompting_wan_30_10_secs_character_sheet/) shows that whole-sheet prompting is used in practice. Another [firsthand sequence report](https://www.reddit.com/r/Akool_Official/comments/1wlcrsn/testing_wan_30_on_akool_candid_couple_sequence/) reports identity difficulty under changing poses/framing and recommends separate shots. Neither establishes an exact lip-sync, occlusion or all-angle fidelity guarantee. Individual crops are a clear way to assign roles, not a measured universal improvement over sheets.

A second reference video is deferred: [Runware's examples](https://runware.ai/docs/models/alibaba-wan3-0/guides/video-and-audio-references) demonstrate video-based identity/motion guidance, but another performance could compete with the driving clip. No undocumented provider parameter or automatic prompt rewrite was added.

No paid quality comparison was performed for this feature. Useful user comparisons are the same source interval, scene image, neutral face, quality, custom instructions and seed with (1) face only, (2) whole sheets, (3) selected individual angles and (4) angles plus relevant expressions. Submit each explicitly and compare identity, head turns, expression timing, hands/occlusion and first-frame fidelity. A fixed seed does not prove deterministic results across different conditioning inputs. More references can conflict and are not automatically better.

## Persistence and recovery

New pack-backed jobs freeze `kie-wan3-v4`: character ID/name/revision, neutral anchor, ordered selected entries, labels/roles, original image SHA-256 values, crop provenance, complete literal prompt and existing prepared/upload receipts. Both character selection and image bytes are checked before upload/submission. Subsequent recovery uses the run's saved inputs and literal prompt; it never resolves a newer character revision or resubmits an unknown paid task blindly.

Character revisions live under separate Kie settings keys. The original GPU Character table, GPU workspace, model inventory and files are untouched. Revision compare-and-swap is repeated after asynchronous hashing. Archives keep revision history. Crops are local FFmpeg PNG extracts, with original-sheet ID/hash and integer crop coordinates. Native crops are pixel-exact; crops smaller than the API's 240-pixel minimum side are uniformly resized with Lanczos and explicitly described as resized, not generated detail. Originals stay unchanged.

New draft/reference properties are optional without defaults. Old v1/v2/v3 frozen drafts and literal prompts keep their existing shape and recovery behavior. The shared crop picker has optional Kie copy/minimum-size props; existing callers retain their original behavior. Host/Origin protections also cover the new local endpoints. Character management and browser fixtures never call a provider, rent a GPU or download models.

See the sanitized [validation record](validation/kie-character-packs-20261106.json).
