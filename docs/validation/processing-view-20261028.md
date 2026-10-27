# Simple processing view

2026-10-28. Image and video jobs share a quiet processing canvas with a blurred local source poster, gentle sparkle/ambience motion, a short stage title and a native progress percentage. Detailed stage text, steps/downloaded MB, elapsed time, dimensions, segment/frame counts, continuity backup state and conditioning-frame link move into a Render details dialog opened with the info button. Cancel and required failure/recovery actions remain visible. Dialog content is portaled outside the canvas and uses the existing focus/close behavior.

The percentage is explicitly **current stage/transfer progress**, not total job completion or an ETA. It reads only finite nonzero native counters, clamps their ratio to 0–100 and can restart on another pass/segment. Queued jobs show zero; stages with no counter display Processing and an indeterminate bar. Errors remain visible in the main view, without the healthy-work animation. Reduced-motion preferences disable ambience/sparkle movement.

TypeScript/production build, `git diff --check`, and fourteen existing checks across adapter storage, inventory, framing, library, sampling and clipping pass. Read-only Vite SSR checks confirmed an actual 25/100 counter displays 25%, absent counters do not invent a percentage, detailed facts stay hidden initially, and errors stay visible. Rendering invokes no callbacks. Full visual/modal interaction review was limited by native browser targeting; no exhaustive responsive or animation QA is claimed.

No backend progress semantics, transfers, frame continuity, models, cancellation/recovery APIs or paid run settings changed. No render/download/compute action or server restart was performed.
