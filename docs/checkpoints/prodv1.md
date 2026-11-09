# prodv1 checkpoint

The user named the current stable workflow **prodv1** on 2026-11-09. The immutable annotated Git tag `prodv1` and branch `checkpoint/prodv1` identify it. Never move, delete or reuse that tag without an explicit instruction.

This checkpoint keeps the production code from `fafad7a906dfa7907b1b2d91a1854aa5f951599e` with a recorded current recipe and these recovery notes. The uncommitted source-face-guide evaluation is separate. Its optional API profiles are not active in the saved production recipe. Independent compilation confirms that the stable code produces the exact same current Remotion and Fix Faces graphs as the working tree.

The saved Remotion recipe is 480p, reference-image scene, 768px motion input, six steps, existing DMAD strength 1, five-second segment limit, audio enabled, seed 0, no extra acceleration and automatic 30fps finishing. [The machine-readable snapshot](prodv1.json) includes model/component choices, pinned configuration hashes and graph verification. The native H3 generation is still 24fps. This is a user-defined recovery point, not a claim of universal production quality.

Private recovery material is stored under ignored `.local/checkpoints/prodv1/`: a consistent SQLite backup, all saved draft/settings values, copies and hashes of the selected Remotion video/photo, and a self-contained Git bundle. User media, credentials and private paths are excluded from Git. Model weights are not duplicated; their existing pinned manifests identify the required bytes. Rental availability and provider state are not part of a code checkpoint.

When the user says **“revert to prodv1”**, **“restore prodv1”** or **“revert to the prodv1 checkpoint”**:

1. Preserve later code work on a separate recovery commit/branch before changing tracked files. Inspect the tag and this snapshot; do not overwrite unrelated uncommitted work blindly.
2. Restore the tracked application/workflow code identified by `prodv1`, rebuild it and validate the recorded recipe/graphs. Keep the immutable tag in place.
3. Restore the recorded module recipe from the snapshot. The private snapshot also retains the original selected input/trim values if that exact example is requested. Keep all newer Library jobs, images, videos, characters and credentials. **Do not restore the whole SQLite backup over the live Library as a routine workflow rollback.**
4. Reload the local app only after generation, transfers, setup, exports and provider actions are idle, using the existing ownership and data-preservation guards. Do not interrupt user work.
5. Do not rent/resume a GPU, delete weights, reset a rental or regenerate paid videos as a side effect of restoring the checkpoint. Missing files still use explicit Download.

The bundle and selected-media hashes provide an independent local recovery copy if normal branches are changed later. A remote GitHub backup is separate from this local checkpoint.
