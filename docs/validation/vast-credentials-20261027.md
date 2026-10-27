# Shared Vast credentials

All Vast operations now read `~/.config/vastai/vast_api_key`, the existing local Vast CLI credential, for every request. Environment overrides and app-local key fallbacks are removed. Replacing the CLI credential takes effect without restarting Recast.

Removed the account/key modal, key entry/replacement/removal controls, credential-source metadata, obsolete styles and the POST/DELETE `/api/cloud/key` endpoints. Missing or blank credentials show an unavailable state with a retry action; alternate keys cannot silently select another account. Credentials remain server-side.

Validation on 2026-10-27:

- `npm run check`: passed.
- `npm test`: 22 files, 274 tests passed. Existing tests cover CLI authentication, rotation, ignored environment/legacy keys, missing/blank credentials, recovery, non-disclosure and removed endpoints.
- `npm run build`: passed, including the production type check.
- Read-only account refresh through `CloudManager` using a temporary local store: configured, no provider error.
- Reloaded only the local Studio on port 3001 after confirming no active jobs, provisioning or pending instance actions. GPU compute and rentals were not started.
- Live Studio account refresh: passed; the credential was absent from its response, and both removed credential endpoints returned HTTP 404.

No credentials or account response bodies are recorded here.
