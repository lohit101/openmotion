# Later-frame reference: live integration validation

The `bidirectional-v1` route was checked with three new parent videos on one RTX PRO 5000 Blackwell 48 GB rental. Every run used balanced/five-update Viggle and automatic Standard + ONNX 60% finishing. These are complete Generate-to-saved-result times, including preflight, input/output transfer, both directions, local joining, facial finishing and framing checks. They exclude initial engine/model installation.

| Parent run | Output | Reference within clip | Full run | Compute estimate at $0.6667/hour |
| --- | --- | --- | --- | --- |
| `b3f4dfd6-d8e3-4f59-9ae2-59738465b9c1` | 73 frames / 3.042 s, 480×864 | Frame 24 / 1.000 s | 170.814 s | $0.0316 |
| `b059e227-4e27-4b46-8df9-bdb689e47f88` | 72 frames / 3.000 s, 704×1248 | Frame 45 / 1.875 s | 270.257 s | $0.0500 |
| `a8ef4b97-7512-443d-b2b9-41321d6367ec` | 216 frames / 9.000 s, 704×1248 | Frame 45 / 1.875 s | 754.204 s | $0.1397 |

The third run additionally froze Samaira's selected body/face views and the new `concise-v1` Imagen refresh recipe. Its earlier direction had 46 frames; its later direction had 171 accepted frames across two native windows. The end-aligned terminal window overlapped 73 previously accepted frames; all those earlier pixels stayed unchanged. The face refresh used the actual previous raw appearance frame 123 within the forward direction, corresponding to original output frame 168. Its child photo `1b011870-eab6-4836-aa07-c6429809d783` completed in **19.820 s**. This child duration is already included in the parent's total, and is not the entire model-switching/boundary overhead.

## What was verified

All three parents completed with exact requested output counts, one retained direction anchor and native 24 fps. FFV1 source extraction and assembly passed decoded-frame SHA-256 mapping checks; the playable MP4 has the original chronological audio. Successful branch outputs, raw animation, final facial output, native histories and photo/anchor receipts are saved separately. No existing paid frames were regenerated to recover these tests.

The boundary photo changed 25,303 pixels inside its face scope and changed **zero of 853,094 protected pixels** outside it. This confirms the body and scene protection on this specific PNG; it is not an identity or pose score. Source/body/face references and the recorded child graph match the frozen character revision. No BFS, Union, Klein or extra generation models were added on this rental.

The automatic face worker corrected 65/73, 72/72 and 216/216 frames respectively. Eight uncertain/covered frames in the hand test retained the generated pixels. Inner face processing/export took 18.909, 23.526 and 69.188 seconds. Those figures exclude worker initialization, input checks and transfers and must not be described as full facial-stage or video-creation times. Actual CUDA providers, hashes and receipts passed verification.

## Visual review

Full-frame and face-crop contact sheets compare source, raw animation and the final result at the same frame numbers. The hand test includes the covered opening and frames directly around its frame-24 join. The outdoor tests include the change in camera distance, frames 44/45/46 around the direction anchor, and frames 166–170 around the later segment join, plus the ending. Private sheets and original media remain in ignored `backups/automatic-face-20261029/` and Studio's local media store.

The outdoor replacement follows the source's changing subject distance; no obvious cut appears at the reviewed direction-anchor frames. The hand test follows gesture timing better than the earlier native result, but fingers/occlusion still fail a pixel-perfect requirement. The new boundary repaint visibly restores reference appearance, while also altering head angle/expression despite its instructions. A raw facial/expression change at frame 169 is reduced by the final source-driven pass. It is not completely eliminated. Facial texture is softer and exact gaze/identity remain imperfect. This is a successful integration test, **not a universal realism or identity quality pass**, and no matched refresh-on/off comparison proves a general improvement percentage.

This mode is not a speed improvement: it adds a directional request, can add a sampling window, and optional Imagen/facial stages add work. The 704p nine-second complete run took 12m34s on this host. A three-minute complete 704p/five-second target is not established by these results.

## Offline/UI checks

The full Studio suite passed 410 tests in 39 files. After the final progress/UI adjustments, 62 focused tests in five files passed; five Python tests cover exact extraction/joining, audio presence, frozen-input/tamper recovery and invalid frame-rate/edge rejection and an explicit export canvas. Typecheck, production build and whitespace checks passed.

Recovery testing interrupts the second direction and proves the first direction's ID/hash remains unchanged. Parent cancellation reaches the real child prompt. A locally saved assembly resumes without a GPU, while an unfinished selected face pass still requires the original GPU. Historical first-frame runs keep their original contract.

Final offline checks additionally ensure Qwen is required only when an actual direction needs more than one window, including fractional-frame range validation. A smaller explicit export canvas models the existing 720p downsampling route and verifies exact branch-pixel preservation. All three paid assembly receipts were rechecked locally after those guards changed; their MP4 hashes stayed unchanged. No additional inference was used for these checks.

Browser checks at 1440px and 390px confirmed the source/reference preview, exact keyboard/frame/time selection, retained trim and absence of horizontal overflow. Selection did not start downloads or compute. The parent is shown once in Library/recent creations/alerts; branch graphs, anchors and boundary photos remain inspectable through run details. The progress estimate starts at zero, retains saved work on resume and reaches 100 only when the final result is ready.

## Costs and stop confirmation

The new rental quoted $0.6667/hour compute, $0.03704/hour retained 80 GB storage and $0.00390625/GB ingress. Its explicitly selected four Viggle, four native Qwen/Turbo and twelve facial files total **48.3996 GB**, approximately **$0.1891** of model ingress. Runtime/container packages and media transfers are additional. All twenty files and the persistent facial runtime were verified; about 29.4 GB free remained. Optional older image adapters were not downloaded.

The earlier A6000 face/Imagen evaluation used approximately $0.1753 compute and $0.0058 facial-model ingress. A conservative new-rental elapsed estimate is approximately $0.491 compute, including creation/setup time and the resumed test interval. Combined compute plus known model transfers is about **$0.862**; retained storage during the goal is about another $0.06. Package/media charges are not itemized here, so this is a tariff estimate rather than an invoice. Per-run costs in the table are part of those session totals, not extra charges. The evaluation stayed within the authorized $1.50 allowance and $0.70/hour compute ceiling.

The five-minute idle pause independently stopped the new instance after the first review. It was explicitly resumed for the combined test. At completion the local and remote generation queues were empty and no facial worker remained unresolved. The initial final stop response was unconfirmed; an independent provider refresh subsequently confirmed **both #58120414 and #58172531 exited/stopped**. Neither disk was destroyed. Combined retained storage continues at approximately **$0.0548/hour** while compute is paused.

Machine-readable sanitized results: [validation JSON](later-frame-reference-20261029.json). Raw account responses, SSH endpoints, user sheets and generated media are excluded from Git.
