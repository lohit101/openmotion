# Compact render cards

Recent creations and Library share `JobCard`. Pending thumbnails now use a short
state label and overall percentage rather than placing the full internal stage
text inside a small thumbnail. The full stage/error remains in a hover title and
the progress accessible value. Queued, reconnecting, failed, cancelled and
interrupted states remain distinct. Finished-media preview/playback is unchanged.

The pending layout is positioned within the thumbnail's bounds with explicit
padding, minimum sizes and overflow containment. Status text truncates within its
row; it cannot expand the card. Percentages use the existing overall-progress
hook, or actual processed-frame coverage for face refinement. No elapsed-time
progress or synthetic frames were added. Animation respects reduced motion.

Validation: production build and focused render-card markup tests. These frontend
changes require no GPU action, inference, model download or backend restart.
