# Connection recovery

## Observed failure, 2026-10-25

The on-demand A6000 rental was running and charging while its ComfyUI process and local SSH master were absent. The persisted generation log stopped at step 4 of 8, without a Python error or completed video for the current segment. The source preparation and reference were retained. All 18 previously completed local library videos were readable.

The provider's container startup log shows startup events at 20:58:10, 21:09:20, 21:15:34 and 21:30:00 UTC on October 24. The container PID 1 start time corroborates the final restart; the physical host had been up for days. The account audit log contained no matching state-change requests at the latter three times. The user reported clicking **Check & resume** after the earlier failure. That does not establish what reset the container: host logs and the previous container's kernel/OOM counters were unavailable. The account had usable credit, this was not a spot rental, and no scheduled account jobs were present.

The app had a separate confirmed bug: when an interrupted prompt disappeared from both the queue and history, **Check & resume** cleared its ID and submitted the segment again. The resulting repeat work could be lost in another container reset.

Compute was stopped and provider state confirmed `exited` / intended `stopped`. Retained storage and models remain; storage continues billing. No new rental or paid render was created during diagnosis. Raw logs, credentials and media are excluded from Git.

## Changed behavior

- Failed queue/history reads can restore forwarding to the same saved, managed instance. Concurrent recovery checks share one attempt. This path never starts a stopped rental, starts ComfyUI, or repeats a prompt submission. A manual disconnect remains authoritative.
- Background SSH uses detached stdin/stdout and a private file for stderr, rather than inheriting Studio's subprocess pipes. Transport logs are under `.local/tunnels/` with private permissions.
- **Check & resume** follows the existing prompt or retrieves its completed output. If both the queue and history lost the segment, its prompt ID is preserved and the UI explains the situation. Only **Render missing segment again** explicitly permits another submission. Repeated check clicks do not submit it.
- Successful completion metadata is written atomically on the Mac before downloading the video. Recovery can use that receipt after ComfyUI's in-memory history is cleared. A completed local segment file is reused.
- ComfyUI launches enable unbuffered Python logging and Python's fault handler. These help diagnose Python/native crashes; a whole-container reset or SIGKILL may still leave no exception trace.

## Limits and validation

A disconnected browser or SSH tunnel can leave a healthy GPU job running. Lost connectivity alone does not prove a failed render and must not trigger an automatic paid retry or stop a healthy job. A reset container loses unfinished sampling state: this workflow cannot resume at step 4 of 8. If neither a completed video nor a completion receipt exists, unfinished frames cannot be recovered.

Local protocol tests cover tunnel repair, bounded read retries, submission ambiguity, repeated resume clicks, explicit rerendering, and recovering a failed video download after history is cleared. Synthetic FFmpeg footage stands in for generated video; these tests validate orchestration, not GPU/model quality or host reliability. Live validation requires the user to resume the rental. The external cause of the container resets remains unresolved.
