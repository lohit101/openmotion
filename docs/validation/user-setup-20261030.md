# Vast account and SSH setup

New GitHub installations can configure their own Vast account from **GPU cloud → Set up Vast account** or **Settings → Connection → Account & SSH keys**. The form accepts an API key and either an installation-generated Ed25519 key or an existing local private-key path. It never accepts private-key contents. No Vast CLI installation is required.

The UI writes the same CLI-compatible credential file used by all existing provider operations. Candidate credentials are verified with instance-list and SSH-key-list reads before saving. Writes are atomic and owner-only. Responses expose public-key/fingerprint/status metadata, never API-key or private-key contents. The transient password field clears after save/close. Retained rentals bind to their original SSH identities when the default changes. A different API key must still access retained rentals, and active work/unconfirmed rental actions block updates.

Configuration preflight now accepts a valid, not-yet-registered public key and explains that launch registers it. Key registration remains a separate part of the explicitly paid launch flow, including the existing exact-key duplicate recovery. Legacy CLI keys and `~/.ssh/comfyui_vast` remain compatible. The removed `/api/cloud/key` routes remain absent; the new strict, same-origin account route is `/api/cloud/account`.

Validation:

- TypeScript check passed.
- Full Studio suite: **40 files / 464 tests passed**, including thirteen new isolated account tests.
- A fresh empty data/home fixture verifies setup without a Vast CLI install. Provider calls are mocked and reject mutations. Existing CLI rotation/non-disclosure and SSH-registration/launch tests also passed.
- Tests cover custom paths with spaces and `~/`, deriving a missing public key, rejecting mismatched pairs/insecure permissions, managed-key reuse, invalid API-key rollback, retained-rental key pinning, preventing account orphaning, active render/download guards, concurrent CLI rotation/work, strict schemas and cross-origin rejection.
- Vite frontend and esbuild backend production artifacts built successfully in an isolated staging directory. Diff whitespace check passed.
- An isolated local UI preview was created with a temporary home and mock provider. Native browser verification was deferred because the user was actively operating the production window; no completed visual QA is claimed.

No real account credential was changed, no provider mutation or paid inference was submitted, and no GPU was started/stopped for validation. The production app was preparing the user's GPU during this work, so its process was left running. Existing generation recipes, saved jobs/drafts and model downloads were not changed by this setup feature. See [the user guide](../user-setup.md).
