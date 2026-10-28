# Clip editor export feedback

2026-10-28. The user's exports were completing successfully, but their progress and Download action were below the timeline and outside the visible viewport. The latest existing MP4 export was confirmed completed; its download endpoint returned HTTP 200, an attachment filename and a nonempty content length. No export was rerun to recover it.

Progress/results now appear directly below the export controls. Clicking Export immediately displays source checking, the button changes while exporting, and completion exposes a prominent Download link. Observed active exports produce completion, failure or cancellation toasts; historical completed rows do not produce a success toast just by opening the editor. Submission failures retain the inline error and also produce a toast. Existing Library receipts and download/master routes are unchanged.

Validation: production TypeScript/build and diff whitespace check passed. Native Brave inspection confirmed the completed export and Download MP4 button are visible above the source browser/preview. The existing file was inspected with an HTTP HEAD request only. No new user-media export, GPU start/stop, inference, model transfer or backend restart was needed. The user's active Chrome draft was inspected without modification.
