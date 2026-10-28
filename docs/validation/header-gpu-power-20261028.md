# Header GPU pause / resume

The header now has one compact Pause/Play button between GPU status and theme.
It controls the connected managed rental, or the sole existing managed rental
when disconnected. Multiple ambiguous rentals, missing rental records, unknown
provider state, and unavailable provider status do not enable a paid action.

Every click refreshes provider status and verifies the same instance/action
before calling the existing managed-instance stop/start endpoint. Resume never
creates another rental. Repeated clicks are locked while checking or submitting.
Pausing during a remote generation or model download first shows an interruption
confirmation; local face refinement does not trigger that warning.

Loading toasts report status checks and submission. A successful stop is reported
only after the existing endpoint confirms it. Resume reports setup started, while
the existing connection tracker reports engine readiness. Success/failure cues
use the existing browser-alert preferences, volume, audio activation and desktop
permissions. Failed requests are not automatically retried. Pausing retains the
remote disk and its storage billing.

Validation:

- `npm run build`: passed.
- `npx vitest run tests/gpu-power.test.ts tests/alerts.test.ts tests/alert-delivery.test.ts`:
  21 tests passed, including target selection, unknown-state handling, retained
  rentals, duplicate-action blocking and existing sound/notification delivery.
- `git diff --check`: passed.
- No live pause/resume, model transfer, inference or server restart was performed.
  Browser inspection found the user viewing their finished video in fullscreen;
  that playback was left alone. Actual header layout and provider actions still
  need an interactive check after refresh.
