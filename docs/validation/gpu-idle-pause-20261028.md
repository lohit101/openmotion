# Five-minute GPU idle pause — 2026-10-28

The user explicitly requested automatic pause after five idle minutes with a
toast and sound. This authorizes an idle compute stop; it does not introduce a
time limit on healthy setup, downloads or inference.

**Settings → Connection → Pause GPU after 5 idle minutes** is enabled by default
and persisted in Studio's local settings. Disabling or re-enabling it resets the
clock. A new app session also starts a fresh interval, without counting offline
time. Workload activity resets the timer; clicking around Library or editing a
prompt does not keep an otherwise unused GPU billable indefinitely.

The server samples activity every 15 seconds. It considers only the currently
connected, ready Recast-managed rental on the known loopback tunnel. Setup,
queued/active/reconnecting jobs, model download/deletion, GPU face setup and
processing, and an unresolved GPU-face interruption prevent idle pause. Existing
CPU exports are independent. A direct read of ComfyUI's running and pending
queues also protects work started in ComfyUI. An offline, unknown, malformed or
unreachable queue resets the interval; it never means the GPU is idle.

Before stopping, the cloud manager gates new work, rechecks the exact rental and
its actual/intended running state, checks the native queue again and verifies
that no new local work, setting, endpoint or rental change invalidated the
decision. In-app request preflight resets the epoch; new paid work cannot enter
while the automatic stop is in progress. External clients are not coordinated
by Recast's submission gate, so the final native queue check is important.

The action uses the existing confirmed compute-stop path. It never cancels a
render, deletes a rental or its models, resumes compute or creates a rental.
Retained storage remains billed. An unconfirmed provider stop produces an error
alert and remains under the existing safety retry monitor. Only an actual stop
confirmation produces **GPU automatically paused**, delivered once through the
existing toast, sound and optional desktop-notification preferences. The
expected disconnect does not produce a second connection-failure sound.

Recast's local server must remain running on an awake laptop. Browser tabs can
be hidden or closed without stopping the server-side timer; browser sounds and
notifications still require an open page and the existing audio/notification
permissions. This is not a provider-hosted watchdog for a powered-off laptop.

## Validation

- Offline timer tests: exact five-minute threshold, long active work, native
  queue activity/errors, setting persistence, disabled/offline/unmanaged/setup
  exclusion, in-flight activity/instance changes, and late stop confirmation.
- Fake-provider lifecycle tests: only a stop PUT on the exact managed rental;
  no delete; new/unknown activity aborts before spending or stopping.
- API tests: saved preference, strict input validation, all inference/setup/
  download/resume gates, drafts/status and manual stop remain accessible.
- Alert tests: no success on an acknowledgement alone, one error on an
  unconfirmed stop, one later confirmation alert, no repeated history alerts.
- Full Studio suite: 35 files / 366 tests passed. Production build and the
  final focused timer/API/alert suite (18 tests) passed after the last changes.
- No paid validation or remote action was needed. The retained A6000 was
  already verified exited/stopped and remained stopped during implementation.

No video-model selection, conditioning, inference setting or shot-handling
change is included in this feature.
