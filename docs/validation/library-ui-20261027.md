# Independent Library and saved run previews

Library now lives in its own `LibraryWorkspace` module. It keeps independent browsing state and opens creations in a Radix dialog instead of moving to a generation editor. Collection tabs are Library, Favourites and Trash; each has All media, Photos and Videos filters. Search covers titles and the correct image/video prompt. Sorting supports creation date in either direction, name and recorded run time, with unavailable times last. Opening/closing a popup preserves current filters and scroll position.

The popup displays an image or the existing video player on the left, with a separately scrolling saved-data panel on the right. It shows recorded model, dimensions, seed, source interval/frame rate where relevant, run time, original inputs, recipe, actual graph sampling fields, saved configuration, prompts and available stage timings. It never invents GPU names, cost estimates or identity scores. Image runs use `job.image.settings`, not the unrelated video defaults on the outer job. Local framing variants retain provenance and link to their parent's original graph.

Favourite, download, rename, reuse and open-workspace actions are available without hiding browsing context. Trash remains reversible; opening a trashed item does not restore it implicitly. The API exposes only a `hasWorkflow` flag while continuing to hide graph, remote uploads and context from bootstrap events. The graph is fetched locally on demand for details. Saved settings can be downloaded as JSON; only recorded graphs get an export link.

Validation: three library data checks cover mixed-media/favourites/trash filtering, correct prompt/settings selection, stable sorting and extraction of actual graph sampling values. Production build and existing image checks pass. Native Chrome inspection verified the Library/Favourites media filters (including photo-only and video-only favourites), both photo/video popups, correct saved sampling values, and preservation of filters on closing a popup. No GPU generation or model downloads were used.

The existing Geist typography, dark/light theme tokens, Phosphor icons and Radix primitives were retained. The preview adapts to narrow screens by stacking media and details; reduced-motion behavior remains inherited from the app stylesheet. Raw screenshots and user media remain outside Git.

Reference: [Radix Dialog](https://www.radix-ui.com/primitives/docs/components/dialog).
