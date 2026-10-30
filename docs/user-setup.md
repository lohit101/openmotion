# Set up your own Recast installation

Clone the repository and start the local app:

```bash
git clone https://github.com/lohit101/openmotion.git
cd openmotion
bash scripts/studio.sh
```

The launcher checks Node.js 24+, npm, Python 3, FFmpeg, FFprobe and the local geometry tools. Open **http://127.0.0.1:3000**. Keep this local service running while using the app. GPU inference requires a separately billed Vast account; opening Recast and saving account details do not start compute.

## Connect Vast in the UI

1. Create a key in [Vast's API-key page](https://cloud.vast.ai/manage-keys/). Allow offer search, instance management, and SSH public-key reading/registration.
2. Open **GPU cloud → Set up Vast account**. Existing users can select **Account**, or **Settings → Connection → Account & SSH keys**.
3. Paste the API key into the password field.
4. Choose **Create or reuse a Recast key** to generate an installation-specific Ed25519 key, or **Use my existing SSH key** and enter its private-key file path, such as `~/.ssh/id_ed25519`. Do not paste key contents or select the `.pub` file. Private-key permissions must exclude other users (`chmod 600 /path/to/key` on macOS/Linux). For encrypted keys, unlock them with `ssh-add /path/to/key` and keep the matching `.pub` file beside the private key.
5. Select **Verify & save**. Recast validates the account with read-only requests and checks the SSH-key pair. Failed verification preserves the previous credentials. The form exposes only the saved public key and fingerprint; no private-key contents are uploaded.
6. Choose a GPU and storage in the marketplace, inspect fees, and optionally run **Check configuration · no rental**. **Rent & launch** is the separate paid action. It registers your public key if needed, creates the rental, installs the blank ComfyUI engine and connects its private tunnel. Explicitly download the model files required by your chosen settings afterward.

No Vast CLI installation, developer API key or developer SSH key is needed. The browser, local backend and SSH-key files must be on the same computer; Recast is a local application rather than a public multi-user credential server.

## Where credentials live

The API key is saved atomically with `0600` permissions to `~/.config/vastai/vast_api_key`, the same location used by the Vast CLI. Requests reread this file, so CLI and UI changes do not create competing copies. The password field clears after save or close. Saved keys never enter the Studio database, browser preferences, generation settings, exports or GPU host.

Generated SSH keys are in the installation's private data directory (`studio/data/private/id_ed25519` by default, or the equivalent directory under `RECAST_DATA`). A custom key remains at its selected local path. Only its public half is registered with Vast. The database stores key paths and each rental's bound path so changing the default does not break retained rentals. Existing `~/.ssh/comfyui_vast` installations keep that default until explicitly changed.

Keep private data and connection files out of Git. Share source code through GitHub; each person should create their own account credentials and private SSH key. The repository ignores `studio/data/` and `.local/`.

## Change or repair setup

Open the account form whenever GPU work is idle. Leave the API-key field blank to keep the stored key while changing the SSH default. Retained rentals must still be visible to any replacement API key; resolve their status before switching to another account. Active setup, downloads, renders and unconfirmed rental/stop actions block credential changes.

Registering an account SSH key does not attach it to instances created earlier. For a manually rented instance, attach the public key using that instance's Vast controls and configure its SSH command with `python3 scripts/vast.py configure --identity /path/to/private/key`. Recast-created rentals keep their own saved key selection. See [Vast's SSH documentation](https://docs.vast.ai/guides/instances/connect/ssh).

If verification reports an expired/invalid API key, replace it in Vast and paste the replacement into the account form. A permissions error requires the appropriate permissions on that key. If a custom SSH key cannot be unlocked, load it into `ssh-agent`; a mismatched `.pub` file is rejected without overwriting it. Existing keys are reused, never overwritten by the setup form.

The shared credential-file location and API-key behavior follow [Vast's API-key guide](https://docs.vast.ai/guides/reference/api-keys).
