# Incoming interactions in the live Remotion UI

The subsequent [long-clip update](motion-interactions-long.md) adds V2 without the five-second selection cap. The V1 limits below describe this initial deployment and remain frozen for old jobs.

On 2026-11-09 the user requested immediate UI integration of the tested incoming-hand/object candidate. Remotion now exposes **Keep incoming hands & objects** directly under Scene & output when the character image supplies the setting. Choosing Character image scene enables the aligned complete-performance guide and exactly one active Motion Transfer adapter at strength1. The source-scene path remains separate; historical graphs and frozen jobs are unchanged.

The control uses the existing `aligned-interactions-v1` backend. It adds neither a detector nor a source-pixel paste. Model behavior and its known identity/hair/occlusion limits are those documented in [the eight-run comparison](remotion-source-interactions.md); this UI integration is not another GPU quality test.

The existing five-second/single-segment limit remains. A selection longer than `min(5, segment limit)` is preserved and clearly blocks Generate, with an explicit **Use Ns from current start** correction. Selecting a new input while the guide is active initially selects at most that limit. A removed, disabled or altered task adapter also shows a restore action before submission. Enabling the guide keeps lip-sync enabled and removes the incompatible experimental face-guide flag; other adapters/settings remain. Four occupied unrelated adapter slots produce a visible error instead of deleting an adapter. Disabling the guide restores the existing original-guide behavior. Fix Faces isolation and historical reuse stay unchanged. Restore imported settings now replaces the settings object so optional experimental flags are cleared too.

Selection performs no installation or model transfer. The existing Download Remotion footer includes only the optional185MB task adapter when it is missing; the current host already has it. No new weights or task variants are enabled for Akatz.

## Validation and live rollout

-52 focused Studio checks pass, including seven UI/helper/actual-compiler cases and the existing interaction, Akatz, Remotion and Fix Faces regressions.
-Typecheck passes both on the working branch and the isolated live build; production frontend build passes.
-Both `prodv1` graph hashes remain exact. Its tag/branch and saved recipe are unchanged.
-The live frontend was built from the actual current backend base5572992 plus these UI files, excluding pending Akatz preparation changes. Assets were copied first and the HTML index replaced atomically. Existing assets and nine already-present equivalent-JS debug maps were retained. HTTP checks verify the served index, entry assets and actual workspace chunk containing the enabled guide/control.
-The same backend process and both unrelated applications remained running. All93 terminal job records and both saved drafts are unchanged across deployment. The connection remained online; no compute action, remote install, inference, model download or app restart occurred.

The user's already-open browser tab is not force-reloaded. Refresh to load the update, then choose Character image scene or turn on the visible switch in an existing reference-scene draft. No browser interaction or extra quality certification is claimed by the static/SSR checks. Private build/deployment evidence is ignored under `.local/motion-interactions-ui-20261109/`.
