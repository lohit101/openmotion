# DGX / datacenter rentals

GPU cloud includes **DGX / Datacenter** and includes these provider names in **All GPUs**: GB10, GB200, GB300, B200, B300, B300 PC, H100 NVL, H100 PCIE, H100 SXM, H200, H200 NVL, A100 PCIE, A100 SXM4 and A800 PCIE. The existing disk adjustment, price sorting, offer revalidation and instance start/stop/destroy controls apply. The workflow rents one GPU; available multi-GPU-only asks are excluded. Selecting the filter or refreshing availability does not rent hardware.

Vast's bundle search silently defaults to amd64 when architecture is absent. Searches now explicitly include both amd64 and arm64; this fixes empty GB10 results when ARM hosts are available in Vast's console. GB200/GB300 require ARM64 but retain reported GPU memory separately from CPU RAM. Only GB10 uses the shared-pool fallback. No combined rack memory is presented as one GPU's memory.

Spark shares memory between its ARM CPU and GPU. Offer cards and the instance manager show one shared pool instead of adding CPU RAM and VRAM together. GB10 offers require a 64 GB-class shared allocation or the higher selected memory minimum. Hosts explicitly reporting an incompatible CPU architecture are rejected before renting. Ordinary discrete GPUs retain their separate RAM/VRAM checks.

GB10 can report `[N/A]` from `nvidia-smi` for dedicated memory. The initial SSH probe recognizes that only for an exact GB10 device match; bootstrap then verifies the actual container-limited shared pool and native ARM64 environment. Missing discrete GPU memory remains an error. The existing required model bundle and generation graph are unchanged.

The current CUDA image has both amd64 and arm64 manifests. The pinned CUDA 13 PyTorch 2.11.0, torchvision 0.26.0 and torchaudio 2.11.0 publish Python 3.12 ARM64 wheels. These are packaging checks, not a successful SCAIL GPU execution or speed benchmark. Spark is therefore labeled experimental in the marketplace. Actual INT8 kernel execution, memory usage, generation quality and timing require a user-started GB10 run.

Sources: [CUDA image manifest](https://hub.docker.com/layers/nvidia/cuda/13.0.2-cudnn-devel-ubuntu24.04/images), [PyTorch ARM64 wheels](https://download.pytorch.org/whl/cu130/torch/), [NVIDIA Spark specifications](https://docs.nvidia.com/dgx/dgx-spark/hardware.html).
