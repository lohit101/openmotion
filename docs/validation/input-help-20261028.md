# Compact input help

Secondary descriptions now live beside their controls in shared info tooltips across Motion control, Image replacement, GPU filters, required files and connection settings. Toggle descriptions use the same pattern. Model choices, sampling, defaults, downloads and generation are unchanged.

The Radix tooltip is portaled outside scrolling panels, collision-aware, keyboard-focusable, dismissible with Escape and toggleable on touch. Triggers sit outside native input labels; switches retain explicit label/control associations. Theme colors come from the existing root tokens.

Setup requirements for the active option, missing files, storage shortages, billing, failure messages, progress, mask instructions and the continuous-shot requirement remain visible. Long recipe and sampler explanations are available beside their relevant labels.

Validation:

- TypeScript and production build passed; the local server serves the new assets.
- Eleven existing UI/storage/framing/library checks passed across five test files.
- A temporary server-render smoke check passed: secondary descriptions are collapsed initially, switch/input labels stay associated, and required disabled-state, billing and reconnect messages remain visible. The temporary test was removed afterward.
- An interactive browser check was attempted but blocked by active user interaction in Chrome; no completed visual or pointer/touch verification is claimed.

No GPU generation, instance action or model transfer was performed for this UI change.
