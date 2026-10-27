# Reserve the local server before opening data

The production entry point now atomically reserves its loopback port before calling `createApplication`. A second `npm start` fails on the occupied port before opening SQLite, reading/writing export records, marking jobs interrupted, seeding media or constructing provider managers. Initialization failure releases the port. During initialization, requests receive a short 503/retry response. This prevents a duplicate app launch from touching a healthy existing session.

Two local HTTP tests confirm that a duplicate startup never invokes its data/job factory and that the existing listener stays healthy; a failed initialization also releases its port for a subsequent start. The combined startup/editor/progress run passes fourteen checks, and the production/TypeScript build passes.

Final deployment was gated on no active generation, model/setup transfers, local exports or pending provider actions. The idle local server was closed gracefully, the updated entry point started successfully, and the existing endpoint was checked with SSH setup disabled. No rental start/stop/resume, model download or paid inference was requested. Existing library count remained 102 across the reload; originals and saved drafts were not rewritten by the deployment.

This also completes deployment of the editor's conservative audio-join handling and cancellation checks recorded in `clip-editor-20261028.md`. The user's selected default is Lossless master plus playable MP4 preview.
