# Library video fullscreen — 2026-10-28

The Library popup caps its ordinary video preview at 65dvh / 660px, with a
smaller mobile limit. Its player also has a contextual maximum height. These
rules continued to restrict the fullscreen descendant.

The shared fullscreen player now explicitly fills the viewport and overrides
the popup's limits. A grid reserves a bottom row for playback/seek/mute/exit
controls while the video uses the remaining height with `object-fit: contain`.
Portrait and landscape media retain their aspect ratio. Normal popup sizing,
comparison playback, media and run settings are unchanged.

Validation:

- Production TypeScript/client/server build passed.
- Three existing fullscreen lifecycle tests passed: repeated enter/exit,
  browser/Escape state synchronization and rejected fullscreen requests.
- In a separate Chrome QA tab, opened the completed nine-second face-refinement
  result from Library, entered fullscreen, visually confirmed a viewport-sized
  portrait with all playback and exit controls visible, and used the exit button
  to return to the same Library details dialog.
- No server/GPU restart, model transfer or new inference was requested. The
  user's existing RTX A6000 render remained active during the UI-only change.

Clients already open before the asset rebuild may need one refresh to load the
new stylesheet. No generation draft or paid output is migrated by this fix.
