# Reusable video prompts

The default in `config/prompts.json` assigns the reference character's identity, clothing and proportions to the output. In **Character swap**, the source video supplies framing, camera movement, subject position/scale, scene, lighting and interactions. In **Motion transfer**, the reference supplies the setting and appearance while the source supplies the performance. Neither prompt invents a room, outfit, gender, hairstyle or fixed camera.

The prompt is a description of the completed video. This follows the [SCAIL-2 authors' prompt guidance](https://github.com/zai-org/SCAIL-2#prompt-semantics). The model was trained on detailed descriptions; a generic default is a useful fallback, rather than an automatic visual caption of arbitrary inputs.

Studio accepts a blank field or a short refinement. The server adds the mode's descriptive base before custom text and does not repeat the base when the field already contains the default. **Use default** restores the visible full prompt; **Clear** activates the same default with no custom refinement. Changing mode updates an untouched default while retaining custom text.

Exact known demo prompts migrate to the new default in saved drafts, reused settings and newly submitted jobs. Whitespace differences are tolerated; edited custom prompts are retained. Historical job settings and captured graphs remain unchanged. New jobs record `promptVersion: scene-v1`; jobs without that version retain their original prompt if continued. Bump the version and preserve the prior resolver if the base changes again. The actual compiled text is saved in each job's ComfyUI graph and shown in Render details.

The editable ComfyUI graph and Python batch client use the same JSON defaults. The batch client's `--prompt` is optional for a new run; resolved text is saved in `run.json`, and resumed runs keep that text. Existing runs intentionally refuse to resume against a changed workflow hash; finish them using their archived original workflow.

The harness loads no extra model and calls no captioning service. It does not inspect pixels, translate arbitrary editing commands into detailed visual captions, detect an outfit, repair a wrong mask, enforce physical geometry, or guarantee face similarity. Custom details can still conflict with the visual inputs. Future automatic captioning must be a separately tested optional component. Negative text has limited influence in the fast CFG-1 preset; adding terms is not a geometric constraint.

Offline regression coverage includes empty/short prompts through the app API, actual native node-31 text, mode switching, exact-only migration, historical metadata preservation, and pre-harness continuation. Render quality and the proposed source-relative reference alignment still require a controlled GPU comparison against the saved baseline.
