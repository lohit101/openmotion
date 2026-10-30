# Private facial comparison viewer

`face-continuity-review.html` is a standalone viewer for local, already-rendered
comparisons. It does not connect to a GPU, submit inference, alter Studio data,
or load third-party scripts. Serve it on loopback beside a private `cases.json`
and the referenced media using an HTTP server with byte-range support.

Do not commit `cases.json`, reference images or generated/source media. The
current evaluation is served from ignored backups at
`http://127.0.0.1:3012/artifacts/` while its local server is running.

The manifest is `{ "cases": [...] }`. Each case contains:

- `id`, `title`, integer `frames`, `fps`, `width`, `height`.
- Relative media paths `reference`, `source`, `raw`, `current`.
- `variants`: `{ id, label, description, url }` entries, and a `preferred` ID.
- Optional `secondary`: the initial fourth-panel variant, when comparing two
  candidates. Unknown or missing choices fall back to the first verified variant.
- `matrices` and `sourceMatrices`: one full-frame-to-512-face affine matrix per
  frame; an unavailable matrix is null. Source and target use separate maps.
- Optional `events`: `{ label, short, frame }`, `initialFrame`, and `notes`.

The source, saved output and candidate have synchronized seeks, frame stepping,
normal/slow playback and issue loops. A fourth panel compares two candidates.
Face close-ups use the recorded transforms; full-frame view preserves framing.
Manual seeks target the same exact output frame. Playback corrects drift over
75 ms and is for visual review, not a frame-exact export or numerical metric.

Before serving a manifest, verify all referenced hashes, decoded frame counts,
frame times, dimensions and original audio packets against the immutable parent.
The current evaluation's private builder performs these checks. The viewer
does not independently verify a media checksum in the browser.
