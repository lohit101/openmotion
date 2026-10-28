# Saved characters and Imagen references

Characters is a separate local workspace. A character stores a name, a body-sheet asset, a facial-sheet asset, optional asset-bound default view rectangles, and a revision. Save/edit/search/archive/restore work without a GPU. Archiving a profile retains its uploaded sheets and existing creations; it is not a storage deletion operation.

Imagen offers **Reference image** and **Saved character**:

- Reference image supports a real two-photo native Qwen edit: source scene plus one character image. A separate face close-up remains optional. Without it, the new `body-only-single-v1` graph has two references and no hidden third image or face crop. It uses the same native core/Turbo files, source-clothing prompt and accepted sampling defaults. This new two-reference route is protocol/CPU-tested, not a fresh visual-quality pass.
- Saved character uses its body and face sheets with the accepted native three-reference recipe. Select one body view and one facial view; defaults load from the character and can be overridden per edit without changing the profile. The source photo still controls clothing, accessories, pose, composition and lighting.

New profile jobs freeze the character name, revision, sheet IDs and actual view overrides in `ImageRun.character`. The API rejects stale/deleted/archived selections, mismatched sheets and invalid crop bindings before paid preflight. Later edits to the profile never update a paid job's image inputs or graph. Existing image jobs retain their original behavior and recovery. Loading historical inputs explicitly uses those saved sheets rather than silently substituting a newer library revision.

Character input validation requires two separate readable image references, not video/mask assets. Creating a character does not run image generation, train a model or start downloads. Profile selection in Imagen uses the native source-clothing route; optional experimental head and legacy recipes remain available in direct-reference mode.

Verification on 2026-10-29:

- 71 focused Studio checks passed, covering persistence, API stale revisions and sheet/crop guards, per-run snapshots, graph contracts and existing render/recovery paths.
- 26 Python image preparation/finalization checks passed, including two-input preparation without a hidden face and all earlier mask/fingerprint behavior.
- Production build and type checking passed. Fifteen stored paid photo graphs recompiled unchanged.
- An isolated browser/server with its own ignored database verified actual body/face uploads, naming/saving, both crop pickers, selecting the character in Imagen, per-edit view overrides without profile mutation, returning to single-image mode with no hidden face, and a 390px mobile layout without horizontal overflow. Screenshots and the temporary database remain under ignored `backups/characters-20261029/`.
- The user's ongoing two-segment video was left running; the production server was not restarted during it. No paid inference or model transfer was needed for this feature.

This is the first committed part of the user's request. Automatic Imagen repainting at Remotion segment boundaries follows as a separate change, with its own immutable receipts and validation; this character library alone does not enable that behavior.
