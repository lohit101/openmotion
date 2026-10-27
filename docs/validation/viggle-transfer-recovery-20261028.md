# Viggle saved-output recovery — 2026-10-28

The user's interrupted 14.5-second run requested **348 frames**, 704p, 24 fps, Balanced (five native video passes), on the retained A100 PCIe 40 GB rental. Its first GPU prompt completed successfully in **279.302 seconds**. It had not submitted segment two: only the first graph existed, and the pending ID still referred to the successful first prompt.

## Failure

- The first segment's MP4 and conditioning image were already on the Mac. Its five-frame continuity backup was **52,715,904 bytes**; the interrupted `.part` contained **46,170,112 bytes**.
- `ComfyClient.download` imposed `AbortSignal.timeout(120000)` on the entire response, including the body. Slow transfers could therefore fail while actively receiving data.
- Each retry opened the partial with truncation and downloaded from byte zero. The caller classified the failure as `OfflineError` and marked the GPU disconnected even though this was a saved-file transfer failure.
- A read-only live probe returned HTTP 206 with Accept-Ranges and a matching 52,715,904-byte source. One MiB took about 2.50 seconds in that probe. This supports the transfer bottleneck; it is not a measurement of the original render's complete network history.

## Fix

The shared output downloader resumes partial files using Range and ETag/Last-Modified validators, checks returned offsets and final sizes, and restarts cleanly if the server returns a changed full object. Legacy partials are prefix-checked before appending. Interrupted transfers get three bounded read attempts; completed paid prompts are never resubmitted by this code.

The 120-second deadline now measures **inactivity**, resetting on received data. Healthy downloads can take longer. User cancellation remains authoritative and keeps partial bytes. The completed destination is replaced only after the transfer succeeds.

`DownloadError` leaves GPU connection state separate from file recovery. The job displays **Download paused · completed render kept** when transfer attempts fail, and **Backing up continuity · completed segment is saved** with real MB counters during backup.

## Offline checks

All **287 app tests** passed across 24 files, including eight dedicated HTTP transfer tests: legacy resume, healthy transfer longer than the idle interval, mid-body reconnect with validators, real inactivity, cancellation, changed full object, invalid range rejection and an already-complete partial. Application protocol recovery retains the original paid prompt, does not repaint the character again, and keeps the healthy connection online after exhausted file-transfer retries. TypeScript, production build and whitespace checks passed.

## Live validation

The GPU was paused while implementing and checking the fix, then the **same retained rental** was resumed under the user's explicit authorization. No new rental or model download was requested. The original partial continuity backup recovered to its full size. Both remaining segments completed on the A100, with native execution times of **290.591 s** and **274.480 s**. No connection drops were recorded during recovery.

The original job is now completed in Library: **348 frames, 14.500 seconds, 1248×704, 24/1 fps and one audio track**. Decoded frame hashes match the concatenated segment sequence exactly (124 + 119 + 105 frames). The original first MP4, prepared source and first submitted graph retain their pre-recovery hashes; its paid prompt was reused rather than sampled again. A synchronized frame review at the first join showed no obvious discontinuity in the face, hand placement or exposure; this is a limited visual check, not a general identity score.

The rental was confirmed stopped after both queues were empty. Resume request through stop request was about **859 seconds**: roughly **$0.087** at the quoted $0.363/hour running rate, excluding transfer charges and provider confirmation lag. This is an estimate, not an invoice. The job's total wall time includes its earlier interruption and downtime and must not be read as native generation time.

Raw histories, hashes, logs and telemetry stay in ignored `backups/segmentation-failure-20261028/`; no user media or credentials are committed.
