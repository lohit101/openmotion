# Sampling, HD output and frame rate

Studio offers Fast 6, Natural 8, Quality 12, Quality 16 and Quality 20 steps. The new 12/16 options use the existing undistilled Quality recipe: UniPC, CFG 5 and shift 3, without the LightX2V speed adapter. DPO, relighting and the two user LoRA slots keep their separate settings. No extra model download is needed. More steps do not establish better realism without comparing the actual results.

The existing 480p and 704p options keep their generation and output dimensions. The added **720p / HD export** option renders above the target on SCAIL's existing 32-pixel grid, then downsamples the full frame using ComfyUI's built-in Lanczos ImageScale node before video export. For a 9:16 shot this is 736 × 1312 generation and 720 × 1280 export; for a 16:9 shot the dimensions are reversed. Other aspect ratios retain their shape to the nearest even output dimension. There is no crop, AI upscaler or additional model.

SCAIL's pinned conditioning node uses a 32-pixel size step and encodes driving video at half the requested resolution. See the [pinned ComfyUI implementation](https://github.com/Comfy-Org/ComfyUI/blob/fb3befd168731438f88bc96e0920a538e8649878/comfy_extras/nodes_scail.py#L142). The generated resolution and exported resolution are stored separately per job. Only the new output branch is resized; reference alignment, person masks and saved continuation frames stay at the generation dimensions. Existing jobs without an output size retain their original export path.

Frame-rate choices remain 16, 24 and 30 fps. New settings default to 24 fps; explicitly saved drafts and previous jobs retain their chosen frame rate. The frame count, source preparation, ComfyUI export and final audio assembly use that same setting. Changing fps does not mean replaying the same frames at a different speed. The running job and the latest completed five-second output were already 24 fps when checked.

This change was prepared in an isolated Git worktree to leave the active render, local production app and GPU connection untouched. It requires activation after the current render finishes. No paid GPU test was submitted.
