# Facial-performance evaluation receipt

See [research, visual observations and deployment decision](../facial-performance-research-20261028.md). This report records limited diagnostics, not an identity or pixel-accuracy pass.

- Baseline: `9a617616-ec4c-48e6-bd2f-d3662caaf353`; 78 frames, 704×1248, 24 fps.
- Audio comparison: native prompt `e5a1dfac-56eb-47f4-b815-460cd21f4ac4`, 173.048 seconds, same source/reference/seed/schedule. Success, 78 frames, 3.25 seconds. No new rental; A100-PCIE-40GB at $0.333333/hour compute.
- Audio output SHA256: `c75e04b2bfc0a19a9d01d4e05016f218ccce55c63e800c145e23756d2f47fc60`.
- Local CPU expression preview SHA256: `49120dbaf2b2d15b0c60a518def16c6e7f9b878b0a509b8ee649e7a16c26ef65`; 218.914 seconds, original paid video reused, no additional Viggle inference. Frames 74–76 left unchanged after ambiguous detection. First-frame-calibrated relative probes rejected for eye/gaze regressions.
- Native pin log: source 104000 samples at 32 kHz, codec/grid length 121333 samples, 150 target audio latents held clean. Logged tail silence is outside the selected soundtrack; all 78 requested video frames are retained.
- Five isolated node tests passed. Input tensors remain unchanged; existing first-two-video-latent continuation mask remains unchanged; only audio receives a zero noise mask. Missing soundtracks, bad waveforms, grids, audio VAE rate and insufficient/nonfinite codec output are rejected.
- All 34 isolated node/runtime/continuity/download/assembly regression tests passed. Native CPU ComfyUI validation passed all eleven API graphs, including the audio example, plus continuation/mask/helper checks. The temporary validation checkout needed the already-pinned Viggle node source installed before that full check; no remote GPU or weights were used for it.
- The idle runtime was reloaded for the opt-in node. Its first restart attempt saw the shutting-down listener before release; an inspected subsequent start restored it. No user render was active or interrupted, and no paid prompt was duplicated.
- Both native and Studio queues were empty before the confirmed compute stop. Models/media/storage retained; no source draft/default, existing run or application setting changed.
- Stage-based cost calculation is about $0.01989 including native compute, its running disk, one VAE download and result transfer. This excludes setup/reload/idle and retained storage; no invoice-level total was measured.
- The observed complete running window, including research idle/reload, was 1015.435 s and corresponds to approximately $0.10482 including those measured transfers. Charges before the first capture and retained disk after stopping are excluded. This broader estimate, not just the native-render cost, must be disclosed.
- Raw model metadata, SHA256-verified transfer receipts, source/output contact sheets, face comparisons, probe scripts, native graph/history and stop confirmation remain under ignored `backups/facial-motion-20261028/`.

Outcome: no production-quality pass. Keep audio pinning manual/experimental. Source-driven expression correction is a stronger candidate, with explicit iris/gaze, foreground occlusion and actual-shot-boundary work still required.
