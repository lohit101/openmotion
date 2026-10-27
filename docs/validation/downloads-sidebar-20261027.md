# Downloads and navigation · 27 October 2026

## Downloads

Settings now has Connection, Downloads and Extras tabs. Downloads lists all known models and uploaded LoRAs, including the core files that Extras intentionally omits. It shows their workflow/feature uses, logical file size, complete and partial bytes, transfer state and optional LoRA removal. Search, workflow/status filters and size/name ordering help find large or unused files. Shared image/video preparation files appear once with both uses.

The existing read-only SSH inventory now includes actual sizes for pinned core files as well as discovered LoRAs. Snapshots are stored per Vast instance or manual endpoint, with a check time, GPU label and last measured free space. Offline snapshots remain informational: live readiness still becomes unknown while disconnected, controls cannot write to historical rentals, and scans do not start compute or downloads. A connection-change check prevents saving the old GPU's results under a new rental.

The already-running A40 returned **9 files, 45,729,466,168 bytes** and **23,949,176,832 bytes free** during validation. All nine model sizes were measured; there were no partial files. These are that scan's figures, not fixed capacity estimates. The local app server was reloaded only after Studio/native queues were empty. The A40 and ComfyUI engine remained running. No generation, model transfer or GPU lifecycle action was submitted for this feature.

Validation: production TypeScript/build passed; the full Studio suite passed **252 tests**. Two additional rendering checks passed for offline inventory totals/shared uses, disabled offline removal and the empty inventory state. Backend tests cover persistent snapshots, instance separation, changed-connection rejection and existing explicit-download behavior. Raw inventory/bootstrap captures remain ignored; no credentials, media or databases are committed.
