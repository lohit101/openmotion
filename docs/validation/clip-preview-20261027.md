# Uploaded media previews and five-second selection

Filled upload tiles now open a media preview. Replace remains a separate action, and drag/drop still accepts replacements. Uploaded photos show only the image and its name/close control. Motion videos open an iPhone-style filmstrip with two trim handles, a draggable selection, preview playback/seek/mute, precise timecodes and an explicit Use this clip action. Keyboard arrows move a handle one output frame; Shift moves ten frames. The selection is bounded by the original duration and a five-second maximum.

New videos are copied to the local app before trimming, but remain pending for the motion draft until the user applies a clip. Cancelling preserves the previous input and selection. The original stays local and unchanged; `prepareVideo` sends only the chosen interval to the GPU when the user later generates. Existing run settings and paid files are never rewritten. Reloading/reusing a longer draft bounds the new editable selection to five seconds. The separate Duration and Clip starts at inputs were removed; the selected range is visible below the video tile.

`shared/clip.ts` centralizes output-frame alignment, minimum valid clip length, range resizing/movement and time formatting. New frame counts avoid floating-point ceil errors at 30 fps, while existing paid jobs retain their saved frame targets. Videos shorter than five output frames cannot be applied. Filmstrips are generated from real frames by local FFmpeg, cached once per immutable video asset and deduplicated across concurrent requests. No rented GPU, model download or inference is required for previews, trimming or Library browsing. A live cached/first local filmstrip request on the existing short input completed in about 0.09 seconds; this is not a guarantee for long media.

Validation:

- Three clip checks cover source bounds, five-second limits, subframe/short inputs, start/end/window dragging logic, frame alignment at 16/24/30 fps and rounding to the exact selected frame count.
- Two actual FFmpeg checks verify that a nonzero selection starts/ends in the expected source colour intervals, has the expected duration/fps, preserves original bytes, and creates/reuses a real 12-frame filmstrip.
- The three Library data checks, 23 image/compiler/import checks and 33 existing application API/recovery checks also pass; production build passes.
- Native Chrome inspection verified the complete trim layout with Apply visible, dragging the selection, the five-second handle cap, keyboard frame adjustment, applying a nonzero start, its persisted API values (1/24 second start, 119 frames at 24 fps), and plain image preview. The original 0–3 second draft selection was restored afterward. Cancelling a later drag left that draft unchanged.

During visual checks an intrinsic video-size overflow was found and corrected by absolutely containing the video within a bounded preview stage. The stage height was then reduced so the filmstrip, range and Apply button fit together on the laptop viewport. Native browser control initially became unreliable in the existing window; verification continued successfully in a clean temporary Chrome window. No GPU was started or rented for this task.

Long clips remain limited to a single selection. Video segmentation and photo/video workflow merging are outside this change. Very long or browser-unsupported video codecs may need conversion; filmstrip errors retain the usable range controls rather than pretending to show decoded frames.

References: [Radix Dialog](https://www.radix-ui.com/primitives/docs/components/dialog), [pointer capture](https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture), [accessible sliders](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/slider_role).
