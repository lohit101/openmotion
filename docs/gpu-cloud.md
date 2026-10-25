# GPU hosts: cleanup and favourites

## Automatic cleanup of an empty failed rental

New rentals are monitored before ComfyUI installation. A host qualifies for automatic cancellation and destruction when either its container builder explicitly fails, or all of these conditions persist across repeated observations for five minutes:

- Vast supplies no actual container status or progress message.
- The provider explicitly reports unassigned direct ports.
- Independent SSH reachability checks fail, including a fresh final provider check.

Only a rental explicitly recorded as never installed is eligible. Installation clears that permission before any setup package is transferred. Legacy disks default to ineligible. Normal image-loading states, runtime/model installation, existing model disks and render jobs are outside this cleanup rule. An unavailable provider API interrupts the evidence window rather than establishing host failure; a reachable SSH service also prevents silent-host deletion.

Recast requests a stop, sends deletion, and checks that the exact instance is absent. An acknowledged delete alone is not treated as success. Unconfirmed cleanup remains visible in red, blocks another launch, and is retried by the local server, including after a server restart. If the host reports running during the final cleanup check, deletion is cancelled. Confirmed failed hosts are excluded from search and launch revalidation for 24 hours. Another rental is never created automatically.

Keep the local Recast server open for monitoring. A failure after installation keeps the existing stop-and-retain-disk behavior. Manual pause and destroy controls remain available.

The user-created RTX 5090 rental #57706658 was independently confirmed never installed, opted into this rule, and removed by the monitor on 25 October 2026 at 18:47:58 UTC. See [the live cleanup record](../validation/auto-empty-host-cleanup.json). No new rental or paid render was created to test this.

## Favourite GPU hosts

Open **GPU cloud → Favourites**. Star a previous rental, an instance, or the host in an offer's details. The bookmark survives destroying the rental. Removing its star deletes the bookmark only.

Favourites identify the physical machine and GPU model. Vast may allocate a different physical card within a machine with several matching GPUs. Saving a host expresses the user's preference; it is not an automatic performance or reliability certification.

Set storage, RAM, network and verification filters, then check availability. Each search targets that saved machine and GPU; Recast never substitutes an unrelated cheaper host. Available cards offer **Review offer**, using the same hardware, transfer-fee, storage and price breakdown as the marketplace. Rental approval and launch revalidation still apply to the fresh offer. Checks do not rent a GPU.

Availability, price and quotes are checked afresh after app restarts. API failures are shown separately from unavailable hosts. A host can be unavailable because it is rented, offline, or no longer meets the selected configuration. Host checks use at most three concurrent requests. Up to 50 favourites can be saved.

Validation: 197 tests across 13 files, production build, and isolated desktop/mobile browser checks. See [the UI and availability validation](../validation/gpu-favourites-ui.json).
