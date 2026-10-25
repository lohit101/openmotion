# Fast engine startup

The observed GB10 rental remained in Vast's `loading` state for more than 20 minutes, with no SSH service and zero model bytes downloaded. The immediate delay was the provider's container pull/unpack phase. Its daemon log recorded the 28.86 MB base layer completing about 27 minutes after the pull began. Other small layers also took minutes. This establishes very poor image delivery on this host; it does not isolate network routing, registry retries or host I/O as the sole cause. A host's advertised network rating is not a measurement of its route to Docker Hub or Hugging Face. A smaller image alone cannot guarantee a fast launch on this host.

The previous CUDA/cuDNN development image had 4,343,695,524 compressed bytes on ARM64 and 4,323,097,381 on amd64. The replacement `nvidia/cuda:13.0.2-base-ubuntu24.04` has 133,135,420 and 139,444,203 bytes respectively: approximately 97% less image data. Both have native ARM64/amd64 manifests. The workflow uses pinned PyTorch binary wheels; it does not build PyTorch or custom CUDA extensions. Basic C/C++ build tools remain available for runtime dependencies; the full CUDA SDK is not installed at startup.

The new sequence is:

1. Vast loads the small base image and starts SSH.
2. Install the minimal OS tools, pinned Python/PyTorch binaries and ComfyUI. The uv installer handles Python packages; source builds of PyTorch are not used.
3. Check CUDA and live ComfyUI schemas, connect the engine and open Studio.
4. Download only the files needed by the selected render settings after an explicit click. Existing verified weights and partial downloads are reused.

No model weights, unrelated LoRAs or example media download at engine startup. The existing runtime-cache health check avoids reinstalling packages on the same healthy instance. The legacy full Natural recipe is still available through an explicit `RECAST_SETUP_MODE=required` CLI invocation.

New marketplace searches default to a 1,000 Mbps host rating. The user can choose Any, 500, 1,000 or 2,000 Mbps; no minimum forces a new rental. An offer's estimated model transfer time is a theoretical lower bound, excluding installation, protocol overhead and origin routing. The normal price and transfer revalidation remains in place before renting.

The five common model files total 26.65 GB. Full Natural with detail and relighting uses 29.74 GB. At 240 Mbps that full recipe needs at least 16.5 minutes of model transfer; at 1 Gbps it needs about 4 minutes, plus installation and verification. A blank engine in under five minutes is a target on a fast host, not a benchmark result or a provider guarantee. A cold render-ready setup is a different measurement. Destroying a rental removes its runtime and model cache.

Runtime logs are followed at one-second intervals. Download counters update about once a second when bytes arrive, with speed derived from actual transferred bytes. Provider status messages are retained when they change; a provider that emits nothing while unpacking a layer cannot supply continuous progress. Slow setup warns and continues. Only actual failures request a compute stop.

An existing rental keeps the image it was created with. Updating the application cannot replace an in-progress image pull. Reconnecting a running/loading container now follows it without sending another start request. The current rental must be replaced explicitly to use a different image; no replacement rental is created by these changes.

Sources checked 2026-10-25: [NVIDIA CUDA image metadata](https://hub.docker.com/v2/repositories/nvidia/cuda/tags/13.0.2-base-ubuntu24.04/), [previous image metadata](https://hub.docker.com/v2/repositories/nvidia/cuda/tags/13.0.2-cudnn-devel-ubuntu24.04/), [PyTorch binary installation](https://pytorch.org/get-started/locally/), [Vast loading-state documentation](https://github.com/vast-ai/docs/blob/main/guides/instances/manage-instances.mdx). Vast documents that compute is not charged during image loading; compute is charged for runtime/model installation once the container is running. The displayed accepted running quote is not an accrued-charge counter.
