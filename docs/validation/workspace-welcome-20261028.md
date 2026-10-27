# Empty preview and welcome screen

2026-10-28. Image and video workspaces now start with an unselected preview. A muted Recast mark and Open library action replace the previous automatic latest-result fallback. When an active job exists, View current render opens its actual progress; closing a preview never cancels that job.

Each selected preview has an accessible close button in its workspace header, including narrow layouts. Closing clears only the viewed job and comparison/details presentation. Uploaded assets, trim range, image mask, model choices, prompt and settings remain in their independent drafts. Generation still opens the newly submitted job; Library/Open workspace and recent-result actions still explicitly select saved media. No paid result is deleted or rewritten. Library browsing/details behavior is unchanged.

Validation: production/TypeScript build passes. An isolated Vite server-side render against the local bootstrap confirmed that a null photo selection displays the welcome screen despite saved photos, selecting an actual photo exposes the close control, and rendering either state changes no draft or callback. No mutation/paid API was invoked by that check. Video selection uses the same explicit ID-only lookup and its close handler contains no API call. Full interactive close/reopen and responsive browser validation were limited by native window targeting; no complete visual sweep is claimed.

No server restart, GPU control, download or generation was performed.
