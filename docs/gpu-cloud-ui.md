# GPU cloud simplification

The November 11 update keeps one marketplace and **My GPUs**. It replaces the large search form with numeric price, VRAM, RAM, storage and download limits. Additional host filters sit under **Filters**. Account setup stays in Settings. GPU favourites, timestamps, promotional headings and the separate configuration-check button are removed. Existing saved-host records remain stored, but their application actions return 410; Library favourites are unchanged.

The desktop review panel has its own scrolling body and a separate, always-visible rental footer. Phones and narrow windows use a Radix dialog with the same review content and footer. Hardware/network information is collapsed; the score uses a hover/focus/tap tooltip. Rental and instance costs, unknown hardware readings, provider errors and storage billing stay visible where relevant. Instance cards retain their hardware and existing lifecycle actions.

Components use the existing Radix, Phosphor and Geist stack, owned button/input-group styles and shared monochrome tokens. No new package or styling-framework migration is required. Motion is limited to control feedback and respects reduced motion.

## Ranking

`value-v2` ranks the entire eligible result pool, then chooses up to three distinct machines. Capacity is a filter, with no extra points for unused VRAM or RAM.

For each host, let `c` be its GPU-plus-selected-disk hourly price. The performance index is:

```
p = (DLPerf / 100)^0.65 × (memory bandwidth in GB/s / 1000)^0.35
work per dollar = p / c
```

Both ratings must be reported and positive for a recommendation. Other eligible hosts remain inspectable as **Unrated**. This index uses provider estimates, not measured H3/Qwen/Clarity render speeds.

The score allocates:

| Component | Points | Calculation |
| --- | ---: | --- |
| Compute per dollar | 85 | Host work per dollar / best work per dollar |
| Setup + work cost | 10 | Cheapest estimated scenario / host scenario |
| Reliability | 5 | Provider reliability fraction |

The setup scenario is one reference-hour of work plus one cold model transfer:

```
transfer seconds = model bytes / min(download MB/s, reported disk MB/s)
scenario cost = c / p + model ingress fee + c × transfer seconds / 3600
```

Mbps is converted to MB/s before estimating transfer time. The scenario is a ranking aid, not a promised setup time or invoice. Network/setup can contribute only ten points; a small internet advantage cannot overwhelm a sixfold hourly-price difference. Tests cover that case, price monotonicity, no capacity bonus, disk bottlenecks, missing ratings, distinct hosts, tighter filters, deterministic results and immutable accepted quotes.

## Common requirements and rental checks

New searches use all hardware families and one retained-Studio baseline: 24 GB-class VRAM, 64 GB RAM, 250 Mbps downloads, amd64 and the existing CUDA requirement. The retained 22-file manifest totals 68,383,860,897 bytes; runtime and working reserves currently make the disk minimum **112 GB**, with 128 GB recommended. Shared files count once. These estimates do not request any downloads.

Existing numeric preferences remain, subject to these minimums. Old module/model-name filters migrate to the common pool. Historical quote/filter schemas remain readable. Resolution-specific generation and memory checks still apply; the marketplace baseline does not imply every setting fits a 24 GB GPU.

Removing the manual check does not remove preflight. Rent still checks local tools and SSH, the exact rental ask, compatibility, approved compute/total prices, known transfer fees, active/unresolved work and idempotency before spending. Common-profile rentals retain the native-motion local geometry check. Existing stop, resume, cancellation, destruction confirmation and setup recovery behavior are unchanged.

## Validation and publication

All **778 tests across 65 files** passed; final 30 focused checks, typecheck and isolated frontend/server builds passed. A native Chrome review covered desktop, phone emulation, independent list scrolling, score details, hardware expansion, pinned rental actions, dialog Escape/focus return and a paused instance. The final built CSS selector was checked after correcting a dangling selector encountered during favourites cleanup.

A read-only live search returned 88 eligible offers and three distinct recommendations. Native Chrome also reviewed the published marketplace with the user's existing narrower filters. No rental, resume, stop, model transfer or inference was performed.

Publication waited for an offline, idle app with no unresolved work. A consistent private SQLite backup and row hashes were captured first. The guarded backend reload and frontend publication retained all old served assets; all **120 jobs, 124 assets, zero character records and 20 settings** remained byte-identical. Both immutable production checkpoints are unchanged. Private raw evidence and rollback artifacts are under ignored `.local/gpu-ui-20261111/`; the sanitized receipt is [gpu-cloud-ui-20261111.json](validation/gpu-cloud-ui-20261111.json).

Design references: [shadcn Input Group](https://ui.shadcn.com/docs/components/input-group), [Tooltip](https://ui.shadcn.com/docs/components/radix/tooltip), [Collapsible](https://ui.shadcn.com/docs/components/radix/collapsible). Provider metric context: [Vast concepts](https://github.com/vast-ai/docs/blob/main/guides/concepts.mdx).
