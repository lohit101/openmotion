# Recast · Kie character swap

A local character-swap app using **Wan 3.0 through Kie.ai**. Upload a motion video and a character photo, choose a quality, and save the result in your local Library. **480p is the default**; 720p and 1080p are available.

This is the `feat/kie-character-swap` branch. It keeps Recast’s interface while removing GPU rentals, model downloads, Imagen, Clarity and local facial-processing controls from the dashboard. The original GPU application remains on the original branch. This app does not start or connect to a GPU.

## Start locally

Install Node.js 24 or newer, npm, FFmpeg and FFprobe. Then, from this checkout:

```bash
bash scripts/studio.sh
```

Open **http://127.0.0.1:3001**. The launcher installs locked Node dependencies when needed, builds the app and starts the local server. No Python environment, CUDA setup or model weights are required.

1. Open **Settings** and save your own [Kie API key](https://kie.ai/api-key). The connection check reads your credit balance; it does not generate a video.
2. Upload **Video1** for motion and **Image1** for the character, outfit and scene. Optionally add **Image2**, a facial close-up or multi-angle facial sheet of the same character. Preview and trim the video before generating.
3. Choose **480p**, **720p** or **1080p**, and adjust the prompt if needed.
4. Press **Generate** to upload those inputs to Kie and create a paid task.
5. Recast follows the task and downloads the completed result into **My library**.

The app and library run locally; generation runs on Kie’s service. A Kie account with credits and an internet connection are required to generate. New tasks are never submitted automatically on startup or reconnect.

## Another laptop and mobile screens

To install this version on another laptop:

```bash
git clone --branch feat/kie-character-swap https://github.com/lohit101/openmotion.git recast
cd recast
bash scripts/studio.sh
```

Enter your Kie key in Settings on the new installation. Keys, uploaded media, Library results and drafts are local data and are not included in Git.

On phone and tablet screens, Recast uses bottom navigation and separate **Setup / Preview** views. Generation opens Preview; returning to Setup keeps your inputs and settings. Trim handles and playback controls support touch, and saved-run details expand when requested. Desktop keeps the side-by-side workspace.

The mobile layout does not deploy a public website. The server still binds to `127.0.0.1:3001`: opening that address on your phone points to the phone itself. To use the laptop server from a phone, connect through a private, authenticated tunnel that forwards to localhost, or deploy it behind HTTPS and authentication. Keep the server awake to follow tasks and save results. Do not expose the unauthenticated local API directly to the internet. Remote access is a separate setup choice; this update does not open network ports or change Host/Origin protections.

## Clips and results

New character-swap runs (`kie-wan3-v2`) send the motion clip as `Video1`, the scene-ready character image as `Image1`, and the optional facial reference as `Image2` to `wan/3-0-video`. **Image1 controls the outfit, accessories, hair, body proportions, background, lighting and framing. Image2 controls facial identity, including lips and teeth; Video1 controls movement, gaze, expressions and lip movements.** Without Image2, Image1 also supplies the face. New output aspect-ratio selection follows Image1.

The base prompt follows the user-provided identity/lip-sync mapping without hardcoding a particular garment or background. Additional instructions can override the defaults. The ordered references, actual prompt, input hashes and task ID are saved with the run; legacy paid jobs retain their original prompt and reference behavior when resumed. This is native multi-reference generation, with no separate face-swap pass. Prompt instructions do not guarantee perfect likeness, facial structure or frame-exact lip sync; inspect the actual output.

This version accepts **2–15 whole seconds** per selected clip. Kie limits reference-video input to 15 seconds and reference plus output duration to 30 seconds. Uploaded references must meet the provider’s size, format and image-dimension limits; the app validates them before submission.

Kie bills reference-video duration **plus** generated duration. A five-second reference with a five-second output therefore uses ten billable seconds. The rate depends on quality; see [current Kie pricing](https://kie.ai/pricing). Actual credit usage is shown when Kie reports it.

**Keep source audio** retains the selected original soundtrack locally. Turning it off allows Wan to generate audio. Inspect the returned video’s expressions, occlusions, timing and audio before publishing it.

## Recovery and privacy

- Inputs, drafts, jobs and downloaded outputs live under this checkout’s ignored `studio/kie-data/` directory. This branch uses its own data folder and does not alter the original app’s Library or drafts.
- API keys stay on the local server in a private file with owner-only permissions. They are not saved to browser storage, job settings, exported receipts or Git.
- Media uploads happen only when you explicitly generate. Kie’s upload links expire after 24 hours; generated files are retained by Kie for 14 days, so Recast downloads results locally.
- Saved task IDs are followed after an interruption without creating another paid task. If a submission response is lost before a task ID is known, the app requires review instead of blindly repeating it.
- Stopping local observation does not necessarily cancel the provider’s generation or refund credits. A saved task can still be checked and recovered.
- Keep the local server running to follow progress and download results. Library playback remains available offline.

The API app has no Vast, SSH, ComfyUI, model-download or GPU power endpoints. Historical workflow files remain in the repository for the original application; they are not dashboard features in this branch.

## Development

```bash
cd studio
npm ci
npm run dev
npm run check
npm test
npm run build
```

See [Studio notes](studio/README.md) and [Kie integration details](docs/kie-character-swap.md). Live generation quality and latency require testing with your Kie account; passing offline API tests alone does not establish them.
