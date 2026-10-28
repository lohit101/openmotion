"""Opt-in H3 facial reference experiment; never changes the native main reference.

Viggle was trained with a video and one repainted still. Extra native H3 image
references are an evaluation path, not a trained face-ID adapter or identity lock.
Callers must supply individual undistorted crops, not a tiled character sheet.
"""
import torch
import torch.nn.functional as F


class RecastViggleFaceReference:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "conditioning": ("CONDITIONING",),
            "vae": ("VAE",),
            "faces": ("IMAGE",),
            "short_edge": ("INT", {"default": 384, "min": 128, "max": 704, "step": 32}),
        }}

    RETURN_TYPES = ("CONDITIONING",)
    FUNCTION = "append"
    CATEGORY = "Character Swap/Experimental"
    DESCRIPTION = ("Append up to three individual facial crops as native H3 image references. "
                   "Keeps the source video, main repainted frame and continuation anchors unchanged. "
                   "Extra references are experimental and can affect pose/expression; no identity guarantee.")

    def append(self, conditioning, vae, faces, short_edge=384):
        if not isinstance(faces, torch.Tensor) or faces.ndim != 4 or faces.shape[-1] != 3:
            raise ValueError("Facial references must be RGB IMAGE crops.")
        if not 1 <= faces.shape[0] <= 3 or min(faces.shape[1:3]) < 32:
            raise ValueError("Provide one to three individual facial crops, at least 32 pixels per side.")
        if not torch.isfinite(faces).all() or faces.min() < 0 or faces.max() > 1:
            raise ValueError("Facial reference pixels must be finite and within 0..1.")
        if isinstance(short_edge, bool) or not isinstance(short_edge, int) or short_edge % 32 or not 128 <= short_edge <= 704:
            raise ValueError("Facial reference short edge must be 128..704 on the 32-pixel grid.")
        height, width = faces.shape[1:3]
        if max(height, width) / min(height, width) > 2:
            raise ValueError("Supply a close-up facial crop rather than a full character sheet.")
        if not conditioning:
            raise ValueError("Viggle conditioning is missing.")
        for _, metadata in conditioning:
            refs = metadata.get("minimax_refs", [])
            if len(refs) < 2 or refs[0].get("kind") != "video" or refs[1].get("kind") != "image":
                raise ValueError("Build video-first Viggle conditioning before adding facial references.")
            if metadata.get("recast_face_reference_version"):
                raise ValueError("Only one facial-reference node is allowed per conditioning path.")
        scale = short_edge / min(height, width)
        h = max(32, round(height * scale / 32) * 32)
        w = max(32, round(width * scale / 32) * 32)
        # Resize to the native grid, retaining the crop's aspect ratio to grid precision.
        pixels = F.interpolate(faces.movedim(-1, 1), size=(h, w), mode="bicubic", align_corners=False).movedim(1, -1).clamp(0, 1)
        added = []
        for crop in pixels:
            latent = vae.encode(crop[None])
            if latent.ndim != 5 or tuple(latent.shape[:3]) != (1, 24, 1) or tuple(latent.shape[-2:]) != (h // 16, w // 16) or not torch.isfinite(latent).all():
                raise ValueError("Facial references require the matching H3 video VAE with a finite single-image latent.")
            added.append({"kind": "image", "latent_h": h // 16, "latent_w": w // 16, "latent": latent})
        result = []
        for tokens, metadata in conditioning:
            result.append([tokens, {**metadata, "minimax_refs": list(metadata["minimax_refs"]) + added,
                                    "recast_face_reference_version": "native-crop-v1"}])
        return (result,)
