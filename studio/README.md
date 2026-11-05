# Recast Studio · Kie branch

This dashboard provides character swaps through Kie’s `wan/3-0-video` API. The app runs locally, defaults to **480p**, and also offers 720p and 1080p. The API server binds to loopback on **port 3001**.

From the repository root:

```bash
bash scripts/studio.sh
```

Requirements: Node.js 24+, npm, FFmpeg and FFprobe. The launcher installs locked Node packages if needed. It does not install Python, facial models, CUDA or ComfyUI, and cannot rent or resume compute.

Use **Settings** to save and verify your Kie API key, then upload Video1 (motion) and Image1 (character, outfit and scene) in Remotion. Optionally add Image2, a facial close-up or multi-angle sheet of the same character. Image2 supplies facial identity while Video1 supplies expressions and lip movement. Keep source audio is enabled by default. Each Generate action creates a paid API task; choosing settings and checking account readiness do not.

The interface retains the original player, previews, Library, favourites, reversible trash, theme and alert controls. GPU workflows and rental/download controls are absent. This branch’s `kie-data/` is independent of the original GPU checkout.

## Local data and credentials

Keep `kie-data/` private and back it up with the app stopped. It contains uploads, drafts, job records and downloaded results. Credentials are stored by the server with owner-only permissions, never in browser preferences or exported settings. Neither `kie-data/` nor local secrets belong in Git.

The server follows saved provider task IDs after reconnects. A lost response to paid submission is treated as ambiguous; retry does not silently create a second task. Kie has no documented cancellation endpoint for this model, so stopping local observation is not a confirmed provider cancellation.

## Commands

```bash
npm ci
npm run dev
npm run check
npm test
npm run build
npm start
```

The production and development servers use the Kie-only entry point. Legacy GPU files remain source history and are not registered routes in this app. See [the main setup guide](../README.md) and [API contract notes](../docs/kie-character-swap.md).
