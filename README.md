# SCAIL 2 character replacement on Vast

This project runs full-person video replacement in ComfyUI using the native SCAIL-2 INT8 model. It provides an editable graph, person-mask previews, optional model-matched LoRA slots, source audio, and five-frame continuation between short passes. Start with one person in a single continuous shot.

The local **Recast Studio** dashboard provides paired uploads, prompt/settings controls, before/after playback, a persistent library and native ComfyUI progress. Its **GPU cloud** section searches live compatible RTX offers, prices the chosen storage allocation, launches the pinned setup and manages Recast-created instances. Start it with `bash scripts/studio.sh`, then open `http://127.0.0.1:3000`. It opens offline and does not contact the GPU until you connect. See [the Studio guide](studio/README.md) for account setup, rental controls and the GPU validation boundary.

GPU cloud includes a **Check configuration · no rental** action, exact rental-ask and fee rechecks, duplicate-rental protection and live download progress. A long setup shows a yellow warning after 15 minutes and keeps going. Actual setup failures show red errors and request a compute stop while retaining the billable disk. Keep the local server open to receive status and handle failures. Healthy remote setup and ready instances remain running until stopped.

The prompt now has a reusable scene-preserving default. Leave it unchanged, clear it to use the same base automatically, or add a short refinement. Known old demo prompts are migrated without rewriting historical renders. See [prompt behavior](docs/prompt-harness.md) and the [captured realism review](docs/realism-review.md); improved framing still needs a controlled GPU comparison.

Still-image face/body preparation needs an additional image editor. [The compatibility and handoff review](docs/character-reference-preparation.md) compares a smaller Klein 4B branch with Qwen Image Edit, their extra storage, and separate character views. Neither branch has been installed or GPU-validated.

The generation has no added content-filter nodes or hosted generation API. Existing LoRAs can be loaded locally. Different model architectures need their own compatible branch; a Wan 2.2 I2V LoRA or checkpoint is not automatically interchangeable with SCAIL-2.

The initial validation passed local CPU checks and two real RTX 3090 generations: 3 seconds at 832 × 480, 16 fps and 6 steps. The first run took 130 seconds through the client; adding the SCAIL-2 relighting LoRA produced a better blended result in 105 seconds with cached conditioning. The demo still has clothing/detail variation, and the small face does not establish close-up identity fidelity. Long-video GPU continuity remains untested. See `validation/gpu-report.json` and `outputs/first-gpu-test/`. Consistency is a quality target; the graph cannot guarantee an indistinguishable result on every input.

A third GPU test uses a simpler, front-facing indoor dance at **480 × 768**, 16 fps and 6 steps. It exported 48 frames in 123 seconds through the client, with steadier face, hairstyle and clothing in sampled frames. Some hand and fabric artifacts remain. Its before/after files and exact settings are under `outputs/simple-dance-test/`, with measurements in `validation/simple-dance-gpu-report.json`. On the current instance, open **Character Swap / 04 Simple Portrait Dance**. Direct TikTok download was unavailable, so this test uses UniAnimate’s public vertical dance example; TikTok origin is unverified.

## How the workflow works

```mermaid
flowchart LR
    A[Source video] --> B[Short source window and audio]
    R[Character reference] --> C[Fit reference without cropping]
    B --> D[SAM3 person tracking]
    C --> D
    D --> E[Colored identity masks and previews]
    M[SCAIL 2 INT8] --> L[DPO and optional LoRAs]
    L --> F[Native replacement sampler]
    E --> F
    B --> F
    C --> F
    P[Previous five frames if continuing] --> F
    F --> G[Tiled video decode]
    G --> H[Trim overlap and align audio]
    H --> I[MP4]
    H --> J[Context for next pass]
```

The graph is arranged from left to right: inputs, tracking, models and LoRAs, reference/text conditioning, replacement, sampling, then export. Generation and scheduling share the same patched model. The two sampling presets change steps, CFG and the acceleration LoRA together.

| File | Purpose |
|---|---|
| `workflows/scail2_int8_masks.json` | Inspect the selected source person and reference masks before a render |
| `workflows/scail2_int8_swap.json` | Main editable ComfyUI workflow |
| `workflows/api/` | Matching API graphs for the batch tool and a future frontend |
| `custom_nodes/character_swap_helpers/` | Small local controls, geometry, LoRA and continuation helpers |
| `config/models.lock.json` | Exact file revisions, sizes and SHA256 hashes |
| `config/runtime.lock.json` | Pinned ComfyUI, video-node and PyTorch versions |
| `scripts/vast.py` | Local deployment, connection, backups and LoRA upload |
| `scripts/render_clip.py` | Optional continuation client for a longer continuous shot |

There are two installed node packs: this project's lightweight helpers and [VideoHelperSuite](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite). Person tracking and generation use native ComfyUI nodes. No ComfyUI Manager, paid API integration, separate pose estimator, face-swap model or upscaler is required.

Setup applies one recorded compatibility fix to the pinned VideoHelperSuite decoder: a video with no audio stream returns empty audio instead of failing during ComfyUI caching. Existing sound is retained, and corrupt media still raises an error. The patch hash is recorded in remote `state/runtime-patches.json`; `tests/check_silent_audio.py` checks all three cases against the actual decoder. No soundtrack is synthesized for a silent input.

## Choose a rental

Use an on-demand, single-GPU instance for the first setup. The target is:

| Resource | Starting configuration |
|---|---|
| GPU | RTX 3090 or 4090, 24 GB VRAM; a 5090 is optional |
| System RAM | Prefer 48–64 GB; the tested process reached about 32 GiB resident with relighting. 32 GB needs separate memory tuning and testing |
| Disk | 80 GB allocated, preferably SSD/NVMe |
| Driver | NVIDIA 580.65.06 or newer; offer must support CUDA 13 |
| Template | Vast recommended NVIDIA CUDA or PyTorch, Ubuntu, with SSH access |
| Reliability | Prefer a verified host, high reliability, and good CPU-to-GPU bandwidth |

This CUDA 13 package uses PyTorch 2.11.0 and torchvision 0.26.0. [NVIDIA documents the CUDA 13 driver requirements](https://docs.nvidia.com/deploy/cuda-compatibility/minor-version-compatibility.html). A suitable host driver is necessary even when the container has the right CUDA packages. An older container Python can be replaced automatically with an isolated Python 3.12 runtime.

The seven base model files total **28.619 GB decimal**. The tested relighting adapter adds **1.227 GB**, bringing that bundle to **29.846 GB**. Disk also contains the container environment, a Python environment, temporary frames, uploaded media and results. Additional models, LoRAs or upscalers consume extra space. Inspect the host's disk and download-bandwidth rates before renting; model downloads are billed by some Vast hosts.

Do not choose a huge all-in-one ComfyUI template for this package. It installs a separate, pinned ComfyUI into `/workspace/ComfyUI-character-swap` so it does not overwrite another application.

## First connection and setup

Run these commands on your Mac from this project directory. Python 3 and OpenSSH are sufficient for the connection helper. Local FFmpeg is only needed for assembling the optional batch output.

1. Print your public SSH key:

   ```bash
   python3 scripts/vast.py key
   ```

   It uses an existing key when available. If none exists it starts `ssh-keygen`, where you choose a passphrase. Add the displayed **public** key in Vast's account SSH Keys area **before** creating the instance. Keep the private key on your Mac. [Vast SSH guide](https://docs.vast.ai/guides/instances/connect/ssh)

2. Create the instance using the configuration above. Once it is running, copy the SSH command from its connection panel.

3. Save that command locally:

   ```bash
   python3 scripts/vast.py configure
   ```

   Paste the SSH command when prompted. An existing `-L` forwarding option in Vast's command is ignored because this helper creates the ComfyUI tunnel. No Vast API key is needed. If the private key is not in a standard SSH location, use `--identity` with its actual local file path.

4. Deploy and set up:

   ```bash
   python3 scripts/vast.py setup
   ```

   The command uploads only the setup files. On the GPU host it checks the driver, RAM and free disk; installs the pinned runtime; downloads and verifies the seven models; installs small upstream sample inputs; copies the workflows into ComfyUI; starts the private server; and checks the live node schemas. It then opens your browser. Existing saved workflows and input files are kept on a repeated setup.

The browser address is **http://127.0.0.1:8188**. Traffic goes through SSH to a server listening only on the remote loopback interface. You do not need to expose port 8188 publicly or set up a cloud tunnel.

Setup is the slow part: it transfers 28.6 GB of weights plus runtime packages. Downloads resume from partial files and verified weights are reused. Kernel compilation and model staging can also make the first generation slower than later runs. If SSH drops during setup, rerun `setup` after reconnecting.

If port 8188 is already used on your Mac, configure with `--local-port 8190`, then open the resulting address printed by the helper. The private remote port is 18189, separate from the Vast preset's ComfyUI service. If another application occupies that remote port, change `config/server.json` before deploying and reconfigure the local connection. When Vast's supervisor environment is available, this installation registers a private service with automatic restart. Bare CUDA images use an owned background process instead. Logs are saved in `state/comfyui.log`; process recovery checks the exact installation, port and input directory.

## Everyday use

After restarting the same Vast instance, reconnect with:

```bash
python3 scripts/vast.py open
```

It starts this ComfyUI if necessary, restores the SSH tunnel and opens the browser. It does not reinstall Python or download models again. ComfyUI continues running when the browser closes.

In ComfyUI, open the saved workflow named **Character Swap / 02 Character Swap INT8**. You can also drag `workflows/scail2_int8_swap.json` into the editor. The upstream demo source and reference are installed for an initial check; replace them with your own uploads.

The current instance also has **Character Swap / 03 Tested 3-second Relight**, using the exact inputs and settings from the GPU comparison. Its local editable copy is `outputs/first-gpu-test/tested-workflow.json`. The before/after comparison is `outputs/first-gpu-test/before-after.mp4` (original left, generated right).

1. Upload a short source video in **Upload source video** and the character image in **Upload character reference**.
2. Set **Shot settings** to the correct orientation. Start at 480 × 832 for portrait or 832 × 480 for landscape, 16 fps, 81 source frames. Choose 49 frames for a smaller first test. Dimensions must be multiples of 32. Inputs are fitted with padding instead of stretching faces or cropping the character.
3. Keep `skip_frames=0` and **Previous context** empty for a new shot.
4. In **Describe source person to track**, use a specific description when there are multiple people, such as a person's clothing. The reference prompt should identify the reference subject.
5. Inspect the masks. `object_indices=0` selects the first tracked person after the configured sorting. Keep one intended identity in both the source and reference mask. The separate **01 Check Masks** workflow runs the tracking stage without loading the video diffusion model.
6. Describe the replacement person's appearance, hair, clothing and scene in the positive prompt. The reference supplies the identity; the source supplies performance and environment.
7. Run the main graph. The final MP4 appears in the export node and in the remote `data/output/character_swap/` directory. A separate context record contains the last five decoded frames for continuation.

| Preset | Steps | CFG | Speed LoRA | Intended use |
|---|---:|---:|---:|---|
| `fast_6_steps` | 6 | 1 | 0.8 | Starting baseline and iteration |
| `undistilled_40_steps` | 40 | 5 | 0 | Comparison without the acceleration adapter |

The DPO adapter defaults to strength 1. More sampling steps do not guarantee a better result. Compare presets using the same input, resolution and seed. Keep the source and reference sharp enough that the face is identifiable; a tiny or blurred face cannot establish detailed identity.

For realism, inspect face identity during turns, hair boundaries, fingers, objects held in the hands, feet touching the ground, unchanged bystanders, background structure, and lighting throughout the clip. Do not judge only the first frame. A character sheet or better reference may improve a weak shot more than an unrelated LoRA.

## Continue a longer shot

The workflow keeps each model pass at 81 source frames or fewer. With 81-frame passes, later passes overlap the previous five frames and add 76 new frames. This controls memory and provides a continuity anchor. Hard cuts should start new shots with empty context.

For manual continuation in ComfyUI:

1. Read **Next context path and source end frame** in the editor, or the previous result's execution history.
2. Paste its relative `.safetensors` context path into **Previous context**.
3. Set `skip_frames` to that record's `source_end_frame - 5`.
4. Keep the same source, reference, dimensions, frame rate, prompt, adapters and seed. Queue the next pass.

The loader validates the context geometry, frame rate and source offset. The export removes the five duplicate frames and trims audio to match. A short final source window is padded only for the model's 4n+1 temporal grid, and the extra frames are discarded from the exported result.

For automatic continuation through the same ComfyUI API, keep your SSH tunnel open and run:

```bash
python3 scripts/render_clip.py
```

It prompts for your actual local source video, reference, duration and appearance prompt. Its command-line options also allow resolution, frame rate, source-person description and existing LoRAs. Use `--help` to see the options.

For a 30-second result at 16 fps, it requests 480 output frames using seven short passes. It uploads the media once, saves a run record before each job, carries lossless-frame context on the server, downloads each MP4, and assembles `final.mp4`. Final assembly uses the original audio track once rather than concatenating repeatedly encoded audio. It does not interpolate frames or upscale.

Runs are stored in local `outputs/batches/`. To resume, pass `--resume` with the actual run directory or its `run.json`. An in-progress job is awaited rather than submitted twice. If the instance restarted and lost that job, `--retry-missing-job` can resubmit only the unfinished segment after checking it is absent from the queue and history. Reconnect to the same instance with its stored inputs and contexts for a normal resume.

Longer generation can still drift. The five-frame anchor improves continuity; it does not establish perfect identity over arbitrary durations. Start with a short comparison before paying for a full 30-second pass.

## Add an existing LoRA

Upload a `.safetensors` LoRA with the helper's `push-lora` command and its actual local file path, or copy it into remote `/workspace/character-swap/models/loras/user/`. Refresh ComfyUI's model list, then select `user/filename.safetensors` in **Optional model-matched LoRA A** or **B**. `None` leaves that slot inactive.

The slots delegate to ComfyUI's native model-only LoRA loader. They add no content analysis. Choose an adapter trained for this architecture and check its effect on a short clip before stacking more. Reset continuation context when changing identity, model, LoRAs or prompts.

SCAIL-2 DPO and LightX2V are already in the main chain. The first GPU comparison added `wan2.1_SCAIL_2_relight_lora_bf16.safetensors` in slot A at strength 1. It reduced the bright outline and matched the scene lighting better on this particular shot. The adapter is pinned in `config/optional-models.lock.json` and is installed on the current instance. On a fresh instance, run the downloader with that manifest, then select it in slot A. The seven-file base installation leaves it optional. [SCAIL-2 relighting documentation](https://github.com/zai-org/SCAIL-2#relighting-lora)

On the GPU host, from `/workspace/character-swap`, the optional download command is:

```bash
.venv/bin/python scripts/download_models.py --manifest config/optional-models.lock.json
```

Select `wan2.1_SCAIL_2_relight_lora_bf16.safetensors` in slot A afterwards. It uses the same resumable, checksum-verified downloader as the base files.

Background replacement, upscaling, interpolation and other model families remain separate future additions so the initial installation stays small.

## Logs, backups and billing

```bash
python3 scripts/vast.py status
python3 scripts/vast.py logs
python3 scripts/vast.py doctor
python3 scripts/vast.py pull
```

`pull` downloads outputs, saved workflows and setup records into local `outputs/` and `backups/`. It excludes the large model weights. Generation embeds its prompt metadata in the export, and `state/installed-packages.txt` records the installed Python packages.

Closing the browser, closing the tunnel with `vast.py close`, or stopping only ComfyUI with `vast.py stop-server` does not stop GPU rental billing. Stop the instance in Vast when you finish. Container storage remains billable while stopped. Download important outputs and saved workflows before destroying an instance.

Keeping the same instance gives the fastest next session. Vast local volumes are tied to their host; moving to a different host can require downloading the models again. [Vast storage documentation](https://docs.vast.ai/guides/instances/storage/types)

## Troubleshooting

| Symptom | Action |
|---|---|
| SSH permission denied | Add the public key to the account before creating an instance, or use Vast's instance-specific key management; verify the private-key path |
| CUDA driver check fails | Select a host with CUDA 13 support and driver 580.65.06 or newer |
| Red or missing nodes | Run `setup` to install the pinned core and both node packs; refresh the browser afterwards |
| Models absent from dropdowns | Run `doctor`; check download completion and the generated model-path configuration |
| Model download interrupted | Rerun setup; `.part` files are resumed and completed files are hash-verified |
| Wrong person is replaced | Fix the tracking text, selected object index and reference mask before changing the sampler |
| Face or clothes change | Improve the reference and prompt; use one continuous shot; compare adapters individually |
| Out of memory | Start with 49 frames at 480p-class resolution, remove optional adapters, and inspect RAM as well as VRAM |
| VAE decode runs out of memory | Reduce tiled decode's spatial size from 512 to 256 or temporal size from 32 to 16, keeping valid overlap |
| Continuation context error | Use the matching previous context, identical dimensions/fps, and `source_end_frame - 5`; clear context for a new shot |
| Audio drifts in a manually joined video | Use the batch tool's final assembly with the original audio track |
| Browser stops connecting after instance replacement | Copy the new instance's SSH command and run `configure` again |

The standard server uses PyTorch attention and leaves model offloading enabled. It does not force Comfy Kitchen attention, install SageAttention or xFormers, or preload all model weights into VRAM.

## Validation and upstream references

Local checks cover graph schemas and connections, ComfyUI's own prompt validation, optional-LoRA bypass, aspect-ratio preservation, padded tail trimming, continuation offsets, audio slices, download resume and checksum failures, and SSH-command parsing. CPU checks do not validate CUDA INT8 kernels or generated visual quality.

A live CPU API test also completed two bookkeeping/export passes with synthetic footage, carried the five-frame context, and assembled 94 unique output frames with aligned audio. Model nodes were disconnected from the executed outputs for this test. Browser layout was checked structurally for overlap; interactive GUI preview was unavailable in this session.

Run the standard-library tests with `python3 -m unittest discover -s tests -p 'test_tools.py' -v`. The `tests/validate_with_comfy.py` integration check uses an installed ComfyUI and CPU PyTorch; its help explains the required path. Its temporary filename fixtures validate schemas only and contain no model weights.

The workflow follows [ComfyUI's native SCAIL-2 implementation](https://docs.comfy.org/tutorials/video/zai/scail2), the [official INT8 template](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/video_wan21_scail2_character_replacement_int8.json), and [Comfy-Org's model files](https://huggingface.co/Comfy-Org/SCAIL-2). Research snapshots are retained under `research/`.

ComfyUI and VideoHelperSuite have their own code licenses. SCAIL-2 is published under MIT, Wan support weights under their upstream terms, and SAM3.1 under its model license. Local operation and absence of added filters do not replace those licenses. Sources and exact model provenance are recorded in `config/models.lock.json`.
