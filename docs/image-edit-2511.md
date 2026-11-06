# Image Edit · Qwen Image Edit 2511

Image Edit is a separate module in the local GPU dashboard, under **Edit → Image Edit**. It supplies a Kie-style prompt-and-references interface using the open Qwen Image Edit 2511 model. Existing Imagen recipes, Remotion videos and the separate Kie Wan API app are retained.

This is an alternative implementation, not a reproduction of Kie's private Qwen Image 2.0 weights or serving stack. Matching input controls cannot establish identical outputs or latency. No GPU image-quality or speed comparison was run for this feature.

## Use

Start the GPU dashboard with `bash scripts/studio.sh`, then open `http://127.0.0.1:3000` and choose **Image Edit**. The Kie API checkout can continue independently on port 3001.

1. Upload one to three PNG, JPEG or WebP images, or choose images already in this dashboard's library. Each file must be at most 10,000,000 bytes and 32 megapixels. The first image supplies the default output aspect ratio.
2. Refer to **Image 1**, **Image 2** and **Image 3** in the prompt. The arrows reorder those inputs; update image numbers in the prompt if their roles change. Complete character sheets are accepted as images, without automatically selecting or cropping a face.
3. Choose aspect ratio, canvas and sampling. The default is a roughly one-megapixel canvas, native 40-step sampling and compact INT8 denoiser. Advanced settings offer a BF16 denoiser, PNG/JPEG and a reproducible seed. Both precisions use the matching FP8 vision-language encoder.
4. Connect your managed GPU. The shared footer offers **Download Image Edit** when selected files are missing, with resumable per-file progress and space checks. Selecting settings never starts downloads or compute. Generation is a separate action once files are ready.
5. Preview, compare against Image 1, expand the image, download the result or reuse the frozen inputs. The native PNG remains available even when JPEG is selected. Download a source-frame repaint and upload it to the Kie Remotion app as a reference image; this feature does not change its API provider.

The prompt is passed through verbatim. There is no Imagen character-swap template, hidden prompt translation/rewriter, hand-painted region, face-restoration pass or background composite. Text and images still undergo the model's own native tokenization and conditioning. Whole-sheet identity fidelity must be evaluated rather than assumed.

## Model selection and storage

The pinned files and upstream SHA256 hashes are in `config/image-edit-models.lock.json`. Downloads include exactly one selected denoiser, the matching Qwen 2.5 VL 7B encoder and the original Qwen Image VAE. Existing Qwen Image 2.1 encoders/VAEs are not substituted.

| Selected settings | Required bytes | Decimal GB |
| --- | ---: | ---: |
| INT8, native | 30,137,560,750 | 30.14 |
| BF16 denoiser, native | 50,499,508,486 | 50.50 |
| Matching four-step Lightning adapter, when selected | +849,608,296 | +0.85 |

These amounts exclude runtime, retained files, other modules and working space. Installing both denoiser variants consumes both files; switching settings does not automatically delete weights. Explicit model deletion remains in Settings → Downloads. The full-download setting includes both variants because it intentionally downloads all catalog files.

GPU marketplace estimates use the saved Image Edit draft and selected file bytes. Conservative search floors are 24 GB-class VRAM / 64 GB RAM for compact 1 MP and 48 GB-class VRAM for BF16 or the larger canvas. These are search configuration floors, not verified memory-fit or runtime guarantees. CPU offloading, reference count and resolution affect actual memory use. Prefer a larger disk when retaining Imagen/Remotion weights too.

## Frozen recipe and recovery

New jobs record `image-edit-2511-v1`, the actual precision, ordered reference IDs and SHA256 hashes, source-frame provenance, exact prompt, resolved seed and actual native dimensions. A separate `image-edit-draft` setting preserves these controls without converting the Imagen/Remotion drafts.

The native graph uses `TextEncodeQwenImageEditPlus` for both positive and negative branches with the same ordered images, a fresh 16-channel latent canvas, Euler/simple sampling, flow shift 3.1 and denoise 1. Native sampling uses 40 steps / CFG 4 without an accelerator. Lightning uses the matching 2511 four-step LoRA / CFG 1. Tiled decoding bounds VAE working memory. The optional roughly four-megapixel “2K canvas” is generated directly, not a post-render enlargement; its quality and speed need testing.

Local preparation preserves the full reference composition, normalizes images to RGB PNG and flattens transparency over white. The native node performs its own vision/latent reference scaling. The local helper uses the existing OpenCV/NumPy environment; no additional local model or package is required. A receipt binds prepared pixels, order, settings and dimensions. Changed inputs are rejected before upload; changed preparation/recipe or an unexpected output size stops export while keeping the paid native result.

The normal serialized GPU runner, cancellation, durable prompt/history receipts, reconnect checks, five-minute idle protection, Library and completion alerts are reused. Successful inference is saved before export. **Check & resume** can retry a failed local PNG/JPEG export offline, without submitting another prompt. PNG exports preserve the downloaded native PNG bytes; JPEG uses quality 95 and 4:4:4 chroma. Both retain the native PNG.

## Evidence and limitations

See [validation receipt](validation/image-edit-2511-20261106.json). CPU/protocol and native-browser UI tests establish integration behavior, not generation quality. Reference identity, anatomy transfer, photorealism, 2K fidelity, precision/Lightning differences, GPU memory and Kie speed/quality parity remain unmeasured. No instance resume, rental, model-weight download or paid inference was performed for this implementation.

Primary references:

- [Official Qwen Image Edit 2511 model and native 40-step example](https://huggingface.co/Qwen/Qwen-Image-Edit-2511).
- [Official ComfyUI 2511 guide and matching model files](https://docs.comfy.org/tutorials/image/qwen/qwen-image-edit-2511).
- [ComfyUI multi-image conditioning implementation](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_qwen.py).
- [Matching optional LightX2V 2511 Lightning adapter](https://huggingface.co/lightx2v/Qwen-Image-Edit-2511-Lightning).
- [Kie Qwen Image 2.0 product and input controls](https://kie.ai/qwen-image-2).
