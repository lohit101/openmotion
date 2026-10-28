# FaceFusion processing preference

Settings → Processing now contains **Run FaceFusion locally on this laptop**.
On selects the existing local CPU path; off selects the existing rented-GPU CUDA
path. The default is off/GPU, preserving an existing `recast-face-execution`
choice. The Library selector uses the same observable preference, including
same-tab updates and other-tab storage changes. A blocked browser-storage API
falls back to a session preference.

Changing this setting performs no setup, download, GPU start, inference or
cancellation. Each submitted job retains its immutable execution device, and
resuming it uses that saved device rather than the current toggle. Existing
explicit setup buttons and missing-runtime checks are retained.

Validation: production build; four focused preference tests covering persistence,
same-tab and cross-tab updates, cleanup and blocked storage. No GPU actions or
local server restart were required.
