# Clarity audio-tail export repair

The two 2026-11-09 attempts `53383cbe-6766-4e01-8270-4d94fa1bd42e` and `a5c53319-4e67-4b94-bb43-cf1586ac636c` both finished their 345-frame upscale, then failed with `Original audio failed verification.` Both retained the lossless bridge and encoded partial MP4 on the same rental.

The original has 621 AAC packets; the partial export has the first 620. Its final 82-sample packet was not copied. A local replay using the actual source and synthetic video reproduced the same missing-packet failure. FFmpeg's output `-frames:v` limit ended muxing before the last audio packet was read. The verification correctly refused to publish incomplete audio.

The final export now lets its finite, verified video bridge reach EOF and drains the original audio input. Exact decoded video frame count, rational frame rate, dimensions and compressed-audio hash remain mandatory. The fix changes neither model inference nor the CRF16 video encode. Regression coverage exercises the 345-frame/82-sample tail, exact packet timestamps/padding, fractional-rate silent footage and rejection of an incorrect expected frame count.

The25 focused Python checks complete with24 passes and one existing optional pinned-source check skipped because that cache is absent. No GPU tests were used.

## Recovered output

Only the latest attempt's saved request, attempt, worker status/log and 14.7 MB encoded partial were retrieved over the existing SSH connection. Independently computed remote and local SHA256 values match. No remote files were changed. The local original matches the frozen source SHA256, and the remote attempt/request matches the saved application request.

Local FFmpeg stream-copy replaced the incomplete soundtrack with the original track. All 345 H.264 video packets and timestamps match the saved partial; all 621 audio packets, timestamps and padding match the original. Final dimensions are 720 × 1296 at24fps. No video re-encoding, model download or inference was required. The original attempts, files and their failed status remain as historical evidence; this separately labelled recovery does not invent a successful original worker receipt.

The recovered file is `Downloads/Recast-Clarity-recovered-a5c53319.mp4`; its title and file URL were verified in native QuickTime. The authenticated transfer metadata and full recovery receipt stay ignored under `.local/clarity-audio-recovery-20261109/`. This establishes media integrity and successful opening, not a fresh AI quality assessment or full playback review.

## Deployment and user work

The user explicitly asked to leave their GPU running while they generate other videos. No compute start/stop, engine restart, remote preparation, application reload or automatic test observer was performed. The local source correction is available to the explicit Clarity preparation path. Existing runtime fingerprints remain historical; the next explicit Download/prepare updates the small helpers and reuses installed weights. The active runtime has not been patched during user work. Do not silently mark the previous runtime ready under the new fingerprint or resume either failed attempt's inference.

See [the sanitized validation receipt](validation/clarity-audio-tail-20261109.json).
