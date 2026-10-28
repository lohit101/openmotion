# Additional H3 facial reference — 2026-10-28

The user authorized facial-consistency evaluation on their latest nine-second
Viggle video. Original jobs and media remain immutable. A separate close-up was
cropped without stretching from the approved appearance image. No character
sheet, invented view or additional model weight was used.

`RecastViggleFaceReference` appends individually encoded native H3 image blocks
after the existing driving-video and main-image references. It retains the frozen
text, source, latent, five-frame anchors and existing guide metadata. Up to three
views are supported as separate crops; their effectiveness is unproven. The node
and API example are experimental; Studio generation defaults do not use them.

## Matched test A

- Parent: `34cc5ec9-a0ff-4791-9fdc-066d3c611c72` (original-reference mode).
- Test: `fa7ddaff-1e48-4fbd-813c-35dc30d86bf1`.
- Native prompt: `f13bdce7-2dca-4770-a30b-28cb0395c321`.
- Same first 124 source frames, main image, seed 2735743444, five Euler updates,
  exact balanced sigmas, 704×1248 and 24 fps. Only an additional 384-pixel face
  reference was added. This is new inference, not a reused paid prefix.
- Successful native execution: **270.735 seconds**. The parent's first segment
  recorded 268.216 seconds; cache/startup differences make this a single-run
  comparison, not a reliable speed ratio.
- At this existing A100-PCIE-40GB rental's quoted compute rate $0.350666667/hour,
  this execution corresponds to **$0.02637 compute**, plus about $0.00223
  concurrent storage. Full-session setup/idle/transfer billing is additional.
- Added model weights: **0 bytes**. Incremental peak VRAM was not measured.
- Visual review at frames 0, 24, 48, 72, 96 and 123 found no convincing identity
  improvement. Face shape and expression still vary. **Not a quality pass.**

The idle GPU runtime was reloaded to load the new node. Its first immediate
start encountered a temporarily occupied port after shutdown; a subsequent
verified start succeeded. No active user render was interrupted. This was a
runtime-only restart, not a new rental or model download.

Five CPU node tests verify native reference ordering, independent views,
immutability, duplicate-node rejection, input bounds and wrong-VAE rejection,
including its exact 24-channel spatial contract before sampling.
Raw inputs, graph, native history, contact sheet and paid result are in ignored
`backups/facial-identity-20261028/`.

## Why this was tested

The [native H3 nodes](https://github.com/Comfy-Org/ComfyUI/blob/fb3befd168731438f88bc96e0920a538e8649878/comfy_extras/nodes_minimax_h3.py)
support multiple visual references and timestamped guides, while Viggle's frozen
conditioning was trained with one repainted frame. Native support alone does not
establish a trained facial-identity binding for arbitrary extra crops.
[VK Vigglorious Studio](https://github.com/Tablaski/VK-Vigglorious-Studio/tree/483971fabc8c1a472a4397bafd3b91dcba407e9f)
demonstrates experimental per-chunk references and masked guides; it also states
that sampler and guide schedules remain experimental. Its GPL-3.0 code was read
for research, not copied into this node or installed wholesale.
