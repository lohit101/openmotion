"""Experimental source-soundtrack pinning for the existing Viggle H3 model.

This is target audio, not another reference block. H3's native denoise mask
holds it at clean t=1; the output mux still uses the original source audio.
No weights are fetched here and no existing workflow opts into this node.
"""
import torch


class RecastVigglePinAudio:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"latent": ("LATENT",), "audio": ("AUDIO",), "audio_vae": ("VAE",)}}

    RETURN_TYPES = ("LATENT",)
    FUNCTION = "pin"
    CATEGORY = "Character Swap/Viggle/Experimental"

    def pin(self, latent, audio, audio_vae):
        import comfy.audio
        import comfy.nested_tensor

        samples = latent.get("samples")
        if samples is None or not samples.is_nested or len(samples.unbind()) != 2:
            raise ValueError("Source-audio pinning requires a native H3 video/audio latent.")
        video, previous_audio = samples.unbind()
        if (video.ndim != 5 or video.shape[0] != 1 or video.shape[1] != 24
                or previous_audio.ndim != 4 or tuple(previous_audio.shape[:3]) != (1, 32, 2)):
            raise ValueError("Source-audio pinning requires H3's 24-channel video and stereo 32-channel audio.")
        if not isinstance(audio, dict):
            raise ValueError("This source has no soundtrack. Use the ordinary Viggle graph for silent performance.")
        waveform, sample_rate = audio.get("waveform"), audio.get("sample_rate")
        if (not isinstance(waveform, torch.Tensor) or waveform.ndim != 3
                or waveform.shape[0] != 1 or waveform.shape[1] not in (1, 2)
                or waveform.shape[-1] < 1 or not isinstance(sample_rate, int) or sample_rate < 1
                or not torch.isfinite(waveform).all()):
            raise ValueError("Source audio must be a nonempty, finite mono/stereo waveform with its sample rate.")
        vae_rate = getattr(audio_vae, "audio_sample_rate", 32000)
        if vae_rate != 32000:
            raise ValueError("Use the matching MiniMax H3 32 kHz audio VAE.")
        waveform = waveform.clone()
        if sample_rate != vae_rate:
            waveform = comfy.audio.resample(waveform, sample_rate, vae_rate)
        if waveform.shape[1] == 1:
            waveform = waveform.repeat(1, 2, 1)
        frame_count = sum((1, 4, 4, 4, 4)[k % 5] for k in range(video.shape[2]))
        expected_audio_t = round(frame_count / 24 * 40)
        if previous_audio.shape[-1] != expected_audio_t:
            raise ValueError("H3 audio/video timing grids do not match; nothing was sampled.")
        # Match the released audio-pin recipe's one-frame codec tail. This is
        # silence beyond the selected soundtrack/grid, never invented video.
        sample_count = round((frame_count + 1) / 24 * vae_rate)
        supplied_samples = waveform.shape[-1]
        waveform = torch.nn.functional.pad(waveform, (0, max(0, sample_count - supplied_samples)))
        waveform = waveform[..., :sample_count]
        encoded = audio_vae.encode(waveform.movedim(1, -1))
        if (encoded.ndim != 4 or tuple(encoded.shape[:3]) != (1, 32, 2)
                or encoded.shape[-1] < expected_audio_t or not torch.isfinite(encoded).all()):
            raise ValueError("The matching audio VAE must encode enough finite H3 stereo latents.")
        encoded = encoded[..., :expected_audio_t].to(previous_audio).clone()
        existing_mask = latent.get("noise_mask")
        if existing_mask is not None:
            if not existing_mask.is_nested or len(existing_mask.unbind()) != 2:
                raise ValueError("Preserve H3's nested continuation mask before pinning audio.")
            video_mask, _ = existing_mask.unbind()
            video_mask = video_mask.clone()
        else:
            video_mask = video.new_ones((1, 1, video.shape[2], video.shape[3], video.shape[4]))
        audio_mask = previous_audio.new_zeros((1, 1, 1, expected_audio_t))
        print("RECAST_VIGGLE_AUDIO " + str({"rate": vae_rate, "sourceSamples": supplied_samples,
              "codecSamples": sample_count, "audioLatents": expected_audio_t,
              "tailSilenceSamples": max(0, sample_count - supplied_samples), "targetAudioPinned": True}), flush=True)
        return ({**latent, "samples": comfy.nested_tensor.NestedTensor((video.clone(), encoded)),
                 "noise_mask": comfy.nested_tensor.NestedTensor((video_mask, audio_mask))},)
