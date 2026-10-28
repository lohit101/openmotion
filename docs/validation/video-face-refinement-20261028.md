# Facial consistency / single-profile evaluation — 2026-10-28

The user authorized testing on their latest nine-second video, then explicitly
restricted this iteration to one face profile. No character-sheet support or
automatic Qwen/video merge was added.

## Result

- Immutable parent: `34cc5ec9-a0ff-4791-9fdc-066d3c611c72`.
- New Library result: `3ccc5d8c-d338-436f-9ce0-965c1c2550a4`.
- Native output: **218 frames, 9.083333 seconds, 704×1248, 24 fps**.
- **218 faces processed, 0 skipped**. These are processing counts, not an
  identity-confidence score or a claim that every frame passed a quality test.
- The visible face uses the same approved character reference in every frame;
  it does not inherit a progressively drifting face from the preceding chunk.
- Visual inspection of synchronized facial crops at 0, 1, 2, 3, 4, 5.125,
  5.1667, 6, 7, 8 and 9.0417 seconds found improved facial feature consistency.
  The user independently described a slight improvement. Normal playback was
  also reviewed. This is a useful sample improvement, **not a perfect identity
  pass**; expression fidelity, difficult occlusions and extreme views remain
  unvalidated.

A further CPU-only probe compared the existing identity weight 0.5 with 0.75
and 1.0 at frames 0, 72, 144 and 217. Stronger settings changed facial details
without a convincing consistent advantage across those views, so the tested
0.5 route remains unchanged. These weights are embedding controls, not likeness
percentages; the probe is not a second validated full-video preset.

The full CPU evaluation took **167.992 s**, excluding its initial preflight.
The subsequently tested UI path took **171.403 s including preflight**. Both
produced the exact same MP4 SHA256:
`8283493250aca35020b8057f40a5382b557ebd675e24ffa0f149e364b719db7d`.
The original MP4 is unchanged, SHA256
`88d017f736c9dc86d18bd99567d9f73e65f5ca8a3c949e2a1b5417be0c8d51d1`.

Every saved frame was verified to preserve exact decoded parent pixels outside
the permitted facial area before encoding. The MP4 is a new CRF-16 encode;
compressed background pixels are not claimed to be identical. Both outputs have
218 video frames and 427 original audio packets, identical 9.083333-second video
and audio duration, and the same encoded audio SHA256
`dfa7d495141af8b69e3b69391c7adeaa87467b9125b15220b1b98e74bb60a03a`.

## Usage and costs

The parent Viggle run had already taken 532.817 seconds. The local pass adds
approximately **2m51s / 32%** to that observed sequential runtime on this Mac.
That is a time comparison, not a percentage improvement in identity quality.

There is **no additional rented-GPU inference charge** for this refinement. The
UI test ran entirely with instance `58062839` confirmed exited/stopped. No model
files were downloaded for this task. The already installed local model profile
totals 1.29 GB; its resumable frame cache occupied about 229 MiB for this sample.
If a user leaves compute running during a local pass, normal idle compute fees
still apply (about 1.67¢ for 171 s at this host's $0.350666667/hour compute rate).
Retained GPU storage continues to be billed separately.

The separate [H3 close-up-conditioning experiment](h3-face-reference-20261028.md)
used one new 270.735-second GPU render, roughly 2.64¢ compute, and did not show a
convincing identity improvement. It remains experimental and off the Studio path.
From the first recorded GPU snapshot at 08:55:21 UTC until confirmed stop at
09:08:00 UTC, 759.14 seconds at the quoted tariff correspond to about **7.39¢
compute + 0.62¢ storage**, including research/setup idle time and that render.
This is a measured wall-interval estimate, not a provider invoice or a claim to
account for charges before the snapshot. Transfer billing is additional.

## Validation

- Production TypeScript/client/server build passed.
- 20 focused TypeScript tests passed, including offline local execution,
  concurrent-request deduplication, parent immutability, cancellation/resume,
  altered-frame rejection, frame-rate mismatch, missing-model rejection,
  startup isolation and existing Library/alerts/server regressions.
- Four Python tests passed: fractional timing and VFR rejection, exact protected
  pixels, input-directory protection and no implicit network access on missing
  models.
- UI test: Library → saved original → Refine face, genuine frame progress,
  automatic selection of the separate local job and completion while GPU offline.
  The linked original sampling stays separate from local CPU provenance.
- Private raw frames, full receipts, reference crop, comparisons and GPU history
  remain under ignored `backups/facial-identity-20261028/` and Studio data.

The current Hyperswap/recognition dependency terms allow this private evaluation
route only; no claim of hosted-service clearance is made. See the pinned local
model manifests and [feature guide](../video-face-refinement.md).
