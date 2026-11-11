# Imagen consolidation and module retirement

The former **Image Edit** workspace is now the sole **Imagen** workspace. Its Qwen Image 2.1 INT8 version, ordered one-to-three references, prompt, geometry, Native/Turbo sampling, optional consistency/BFS alternative adapters and saved editable draft are unchanged. The older multi-mode Imagen workspace and Characters workspace are removed, including their unused UI components. An older image can still be viewed/downloaded in Library; reuse copies readable inputs into the current editor and asks for its prompt, rather than silently running the retired recipe.

Remotion, native OpenJutsu Fix Faces, Smooth Motion, Clarity and Clip editor keep their existing generation/processing code and controls. The renamed workspace retains the current Image Edit draft, not the old Imagen draft. Stored character records, their source images, all historical drafts and paid jobs are preserved for history and checkpoint recovery.

The user conditionally approved removing the older custom FaceFusion/ONNX refinement if it had no involvement in the last three videos. Both the initial three-video audit and the final three-video audit found no `faceRefinement`, legacy `facialConsistency` or `faceRepair` pass. The removed Library action and local/GPU preference belong to that retired tool. **Keep** the two Buffalo-L ONNX weights used by the separate native OpenJutsu Fix Faces workflow; a filename ending in ONNX does not make it obsolete.

## Downloads

`config/active-models.json` is the shared TypeScript/Python provisioning policy. It contains exactly the union of all retained built-in presets: 22 distinct files, 68,383,860,897 bytes for the complete catalog. Per-module downloads still select only the files needed by the current settings; this full-catalog number is not the size of an ordinary Remotion download. Shared encoders/VAEs count once.

The 41 other catalog files are retired from new downloads. These include unused SCAIL/Wan, Viggle-specific, Klein, Qwen 2511, former Imagen adapters and legacy facial-finishing dependencies. Full/bulk downloads, Extras, restoration promises, module APIs, managed CLI selection and detached transfer admission all use the active policy. The standalone `scripts/download_active_models.py` entry point explicitly prepares only the native Remotion default bundle, not the full catalog.

Frozen lock files and historical compiler metadata remain unchanged. Installed obsolete files and partials are never deleted automatically. Settings → Downloads → On disk keeps their measured sizes and explicit deletion controls, labelled **Retired files**, without offering redownload. Historical transfers can be observed/cancelled through their original runtime; an unresolved setup stays busy until its stop is known. Retired module setup cannot launch a replacement runtime, including when its selected files happen to be shared with a retained module.

New requests to the removed image, character and refinement APIs return 410 before work. A lost image acknowledgement can still return an already-created paid job by its original idempotency key. Shared source-frame extraction and historical media/graph/recovery routes remain. Older image creation helpers are retained only for historical protocol tests; the live app does not register them. Remotion APIs and saved video recovery remain intact.

GPU rental estimates now use the current Imagen settings; an older saved `image-edit` search is accepted as an alias. The visible marketplace offers only Imagen once. The All modules estimate also covers native Fix Faces and Smooth Motion.

## Validation

The complete Studio suite passes 750 checks. The Python download/protocol/media selection passes 59 checks, followed by a repeated 59-check pass after preserving the legacy fingerprint inputs. Typecheck and production builds pass. New checks cover the exact dependency union, retained ONNX files, mixed-plan rejection, historical deletion, UI navigation, API retirement, preserved drafts and lost acknowledgements. Old protocol tests use an isolated legacy harness to retain paid-format recovery coverage; the real application's retirement is tested independently.

Native Chrome reviewed the new sidebar, Imagen with the existing three references/settings, Post-processing with Fix Faces/Smooth Motion, and Settings without the obsolete device toggle, using a read-only preview. No download, model deletion, GPU lifecycle action or inference was triggered by visual validation. The retained generation sources and historical facial fingerprint inputs match `prodv2` byte for byte; the existing immutable checkpoint references are unchanged. This cleanup makes no new output-quality or speed claim.

The sanitized rollout result is recorded in `docs/validation/module-cleanup-20261111.json`. Private database snapshots, settings/content hashes and build logs remain under the cleanup checkout's ignored `.local/` directory. Do not restore an old database to undo this code change; retain subsequent user media and jobs.

The guarded local rollout waited for the user’s Fix Faces setup and subsequent render to finish. It preserved all 120 job records, 124 assets and seven protected settings/drafts, with the existing offline connection state. Only the local port3003 server was replaced, running this cleanup checkout against the same original data directory. No GPU lifecycle action, model download/deletion or inference was issued. The original runtime files remain available for a code-only rollback.
