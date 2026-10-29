# Fatal container GPU-device configuration

The temporary RTX 4090 evaluation rental reported an explicit Docker/OCI failure:
`failed to inject CDI devices: unresolvable CDI devices`. ComfyUI installation
had not started, the rental remained empty, and no models or user media had been
uploaded. The provider continued reporting `created`, so checking only its state
did not identify the failed startup.

`fatalContainerStatus` now recognizes this specific fatal chain, including
multiline Docker reports. New, never-installed rentals use the existing
recheck → stop/delete → deletion confirmation → 24-hour host exclusion path.
Installed disks still use compute-stop recovery and are never deleted by this
rule. Ordinary CDI installation messages and a slow image pull remain healthy.

Validation: all 96 cloud lifecycle tests passed, including new fatal-CDI cleanup,
host exclusion, and preservation of an installed disk after a later CDI failure.
The actual temporary rental's deletion was independently confirmed. The user's
retained A100 disk was preserved and subsequently connected successfully.
