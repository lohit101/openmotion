# Manual model downloads

New rentals install pinned ComfyUI, its nodes and Python packages without fetching model weights. The GPU can connect before any models are installed. Runtime packages still take time and bandwidth; this change does not make a fresh GPU ready to render immediately.

In Motion control, each quality choice has a separate download button. Clicking **Natural / 8 steps** only selects it; clicking its arrow downloads its T2V acceleration file. **Fast / 6 steps** uses a different I2V adapter and stays uninstalled unless explicitly requested. Natural in Motion transfer uses the I2V adapter. Quality / 20 steps needs neither acceleration file. Relighting and the detail adapter have their own buttons in Advanced settings. Resolution, frame rate, duration and framing share the same models and need no extra files.

The **Settings → Models** tab lists every pinned file, its size, purpose, requirement for the current settings and availability on the connected GPU. Download one file at a time, queue several individually, or explicitly click **Download required files** for the current recipe. That shortcut does not fetch unused features. User-provided LoRAs still use the existing local upload helper and appear after Refresh; Studio never guesses a third-party download URL.

| Recipe | Required weights, decimal GB | Files |
|---|---:|---:|
| Shared models only | 26.654 | 5 |
| Natural swap, DPO 1, relighting 1 | 29.739 | 8 |
| Fast swap, DPO 1, relighting 1 | 29.846 | 8 |
| Quality, DPO 1, relighting 1 | 29.108 | 7 |
| All supported weights/adapters | 30.477 | 9 |

The measured Natural recipe is unchanged. It skips the unused 738,005,744-byte I2V speed file. The five shared weights remain necessary for generation. DPO or relighting at zero strength is omitted from the compiled graph, so disabling it does not require its file. Existing weights are retained; nothing is deleted remotely.

Transfers go directly from the pinned publisher URLs to the GPU disk, with two files at most in parallel. The existing downloader resumes partials, verifies SHA256 and serializes competing writes to the same file. Progress comes from remote transfer counters; unknown or verifying stages use an indeterminate indicator. A slow transfer warns after 15 minutes and keeps running. Failures show red per-file errors and toasts. Cancel stops the local transfer workers and preserves partial files for an explicit retry. It never stops, resumes or replaces the rented GPU.

Downloads require a connected Recast-managed instance and a matching saved SSH tunnel. The API refuses unknown destinations and arbitrary URLs, duplicate active transfers do not start another worker, and rendering/setup/lifecycle changes are coordinated with the download queue. Generate checks required files before creating a job; the Runner also validates the live graph before submitting to ComfyUI. Missing files do not trigger automatic downloads or a paid resubmission.

The marketplace's model transfer estimate describes the selected recipe if requested later, rather than an automatic startup charge. GPU compute continues to be billed while downloading or idle, and allocated storage is billed independently of how many model files have been installed. Destroying a rental removes that disk's model cache.

For direct CLI use, `vast.py setup` now installs the runtime only. To explicitly fetch the standalone Fast graph's base bundle on the host, run `.venv/bin/python scripts/download_models.py --model-dir models`. Optional relighting and Natural manifests remain available for explicit CLI requests. `doctor.py --runtime-only` checks CUDA, nodes and tools without requiring weights; plain `doctor.py` checks the standalone base bundle too.
