# Generate retry acceptance after asynchronous preflight

The full regression run during Clarity development exposed an existing race: simultaneous Generate retries could both pass the stored request-key check, then yield during face-cancellation reconciliation. One later failed the database's unique request key instead of returning the accepted run.

A final stored-key check now runs after asynchronous preflight, immediately before synchronous job construction/insertion. It returns the already accepted job and never submits another paid generation. Existing requests, settings and receipts remain unchanged.

The existing `keeps simultaneous Generate retries idempotent across the asynchronous model check` protocol test passed: response statuses 200/201, one saved job and one mock ComfyUI submission. This is an offline protocol test, not GPU inference.
