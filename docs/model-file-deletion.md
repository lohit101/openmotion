# Delete downloaded model files

Settings → Downloads → On disk offers a trash button for catalog weights, encoders, VAEs, adapters, Clarity weights, face dependencies and partial downloads. The confirmation identifies the file, recorded size and workflows that use it. Qwen's shared files also identify Remotion's optional automatic Imagen repaints.

Deletion operates on the connected managed rental. Saved inventories remain browsable while paused/offline; they cannot authorize deletion on another rental. Existing photos, videos, character sheets, paid run settings and engine/runtime packages are kept. Deleted dependencies become missing, and affected modules require an explicit download before another generation. There is no automatic re-download or GPU resume.

The backend blocks model transfers, setup, active generations, unknown remote face/Clarity work and busy or malformed ComfyUI queues. It checks rental scope and local work again after awaited probes. For ComfyUI weights it requests idle cache release, then rechecks the queue before unlinking. The upstream [free endpoint](https://github.com/Comfy-Org/ComfyUI/blob/master/server.py) acknowledges cache-release flags with an empty response; it does not remove saved history.

Only catalog paths, known isolated face-weight paths and relative custom `.safetensors` LoRAs are allowed. Directory traversal, symlinks, hard-linked targets, non-regular files and held download locks are rejected. Complete weights, partials and their verification stamps are deleted together. Missing files can be retried without deleting anything else. The current small helper runs over the existing SSH connection, so retained rentals do not need an engine reinstall.

The UI refreshes measured free space and invalidates model readiness and saved inventories. Physical inventory takes precedence over a stale ComfyUI filename cache. Removal performs no model hashing, inference or transfers of new model weights. Filesystem free space can differ from logical file size; the displayed free-space total is measured on the rental.

Validation uses temporary local weights, isolated server/model fixtures and the real Downloads screen while the user's rental is paused. No user weight was deleted for testing. See the [validation receipt](validation/model-file-deletion-20261102.json).
