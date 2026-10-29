# Saved-video timing recovery

Job `31f97fe2-d51b-4430-b0eb-43debad9de1a` completed both paid animation windows:
124 accepted frames followed by two, for 126 frames / 5.25 seconds. Face finishing
then failed with “Variable frame timing needs explicit preparation.”

The stream-copy join reported `avg_frame_rate=189/8` although every decoded video
PTS followed the correct 24 fps grid from 0 through 125/24 seconds. The old local
validator treated that header average as authoritative. This was a false timing
rejection, not missing frames or a failed GPU render.

The shared timing validator now accepts an **explicit frozen expected rate** for
automatic Remotion face work and checks every decoded PTS against it locally and
remotely. Generic unknown-rate face inputs retain their previous strict metadata
contract. True variable timing, missing/duplicated frames and absent/non-finite
timestamps still fail. No timestamps, media headers or paid frames are rewritten.
Both existing face-recipe fingerprints are unchanged.

A local validation failure had also left `remoteActive=true`, blocking new jobs
with the generic GPU/download readiness message. Local input rejection now emits
a stopped receipt **only after polling the exact saved worker and confirming it
is not running**. A running or unreachable worker remains protected. The affected
worker was independently confirmed stopped before clearing its stale flag.

The explicit code-only runtime update installs the shared validator and records
its digest in the readiness marker. Inventory and preflight reject older tools
until explicitly updated. All existing weights are reused. The face pass was
resumed on the same A6000; no Viggle or Imagen job was resubmitted.

The completed face worker took **34.328 seconds**, refined 124 frames and retained
two uncertain faces unchanged. Final output is **126 frames, 480×864, 24 fps,
5.250 seconds**. Original compressed audio packets, raw-video checksum, saved
settings, segment list and the two native prompt IDs are unchanged. Frame records
verify exact protected pixels before compressed export. The result is saved in
the original Library run and copied to `Downloads/Recast-recovered-31f97fe2.mp4`.
This validates recovery/timing, not a new identity-quality score.

The subsequent “Download files for these settings” prompt was a cached
`facialRuntimeReady=false` after the manual code update. A real inventory refresh
verified **20 required files, zero missing, facial runtime ready** and emitted the
updated state to the open page. Nothing needed downloading. The interface now
distinguishes a missing facial runtime from missing model files and links to
Advanced's existing explicit tool-update action. Unresolved-worker preflight also
names the previous facial pass and its Check & resume action rather than blaming
downloads. These message changes are built for the next safe app reload; the
timing fix and readiness refresh are already active without restarting Studio.

Twenty-one Python checks and the 419-test Studio suite passed; the final type and
production build passed. Tests cover the exact short-join metadata discrepancy,
real timing defects and confirmed-versus-unknown worker status. See the
[sanitized record](frame-timing-recovery-20261030.json). The current GPU is left
available for the user's next work under their normal five-minute idle monitor.
