# Refresh model download redirects

During the A100 face evaluation, eleven files completed while the remaining
358,188,033-byte `nsfw_3.onnx` advanced only tens of KB/s. The existing pinned
resolver URL resumed from 50,331,648 bytes after adding `download=true` and a
fresh resolver query. The remaining approximately 308 MB completed and passed
SHA256 verification in roughly seven seconds, reaching about 44 MB/s. This is an
observed recovery on one transfer, not a general host-bandwidth guarantee.

Model downloads now refresh Hugging Face `/resolve/` redirects in the same way
GitHub release redirects were already refreshed. The repository, revision,
filename, file size, partial destination, Range checks and pinned SHA256 remain
unchanged. Other URLs are untouched. Already verified files do not request a URL.
No automatic downloads were added.

Offline validation covers pinned-path/query preservation, resolver-host matching,
correct partial resumption, servers ignoring Range, wrong-range rejection and
corrupt-file rejection. Saved output-video transfers use their independent
resumable recovery protocol and were not changed.
