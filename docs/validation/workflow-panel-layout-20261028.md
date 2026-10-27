# Image and motion editor layout

UI-only update, 2026-10-28.

- Both editors use the same section spacing and expandable model, prompt and advanced controls. The selected model/method stays visible in the collapsed heading.
- Upload headers contain just the input label and its help. Replace/Remove sit below the preview; video trim duration and range stay inside that input's column.
- Output controls and actual dimensions are grouped. Viggle's only supported rate appears as a native 24 fps value rather than a one-item dropdown.
- Prepared-frame prompts stay saved and inspectable, with a visible skipped/edited-frame reason. Opening or closing controls does not change draft settings.
- Required files have one collapsed readiness row, individual file controls when expanded and an explicit bulk download for missing files. Offline/setup and storage-shortage messages remain visible. Extras management is available inside the list.
- Image refinements are grouped; painting the replacement area remains part of the main path. Original recipe handlers, models, prompts, masks, queue/submission logic and generation defaults are unchanged.

Validation: TypeScript and production build pass. Fourteen existing checks pass across adapter storage, download inventory, framing messages, library, sampling display and clip selection. `git diff --check` passes.

Visual inspection in a separate local Brave window confirmed the image/motion headers, separate upload actions, scoped trim range, collapsed sections and readiness counts. Opening a photo preview and the image refinements remained available through the accessibility tree. Native scrolling/window targeting was unreliable, so a complete interactive small-screen/light-theme sweep was not completed. The CSS stacks columns when the editor itself is narrow; no mobile validation is claimed.

No paid render, model download, compute action or server restart was performed. An existing user video was running during review and was left alone. Raw screenshots and user media are not committed.
