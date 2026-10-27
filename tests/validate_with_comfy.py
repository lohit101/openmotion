#!/usr/bin/env python3
"""CPU integration checks using real ComfyUI classes; no model inference."""

import argparse
import asyncio
import importlib.util
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


async def validate(comfy_root):
    sys.path.insert(0, str(ROOT / 'scripts'))
    from model_manifest import selected_manifest
    sys.path.insert(0, str(comfy_root))
    os.chdir(comfy_root)
    sys.argv = ["validate", "--cpu", "--disable-dynamic-vram", "--disable-partner-nodes"]
    import torch
    import folder_paths
    import nodes
    import server
    import execution
    from app.assets.manager import default_asset_manager
    from PIL import Image

    server.PromptServer(asyncio.get_running_loop(), default_asset_manager())
    await nodes.init_extra_nodes(init_api_nodes=False)
    spec = importlib.util.spec_from_file_location("local_swap_helpers", ROOT / "custom_nodes/character_swap_helpers/__init__.py", submodule_search_locations=[str(ROOT / "custom_nodes/character_swap_helpers")])
    helpers = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = helpers
    spec.loader.exec_module(helpers)
    nodes.NODE_CLASS_MAPPINGS.update(helpers.NODE_CLASS_MAPPINGS)

    with tempfile.TemporaryDirectory() as temporary:
        fixtures = Path(temporary)
        folder_paths.set_input_directory(str(fixtures / "input"))
        folder_paths.set_output_directory(str(fixtures / "output"))
        (fixtures / "input").mkdir()
        (fixtures / "output").mkdir()
        Image.new("RGB", (64, 96), (100, 120, 140)).save(fixtures / "input/reference.png")
        Image.new("RGB", (64, 96), (100, 120, 140)).save(fixtures / "input/repainted-source-frame.png")
        for name in ['target.png', 'identity.png', 'edit-mask.png', 'face.png', 'face-refine-mask.png', 'source-structure.png', 'body-mask.png']:
            Image.new("RGB", (1024, 1024), (100, 120, 140)).save(fixtures / 'input' / name)
        (fixtures / "input/source.mp4").write_bytes(b"filename-validation-only")
        for item in selected_manifest()['files']:
            relative = Path(item["destination"])
            directory = fixtures / "models" / relative.parent
            directory.mkdir(parents=True, exist_ok=True)
            (directory / relative.name).write_bytes(b"filename-validation-only")
            folder_paths.add_model_folder_path(relative.parts[0], str(directory), is_default=True)
        paths = sorted((ROOT / 'workflows/api').glob('*.json')) + sorted((ROOT / 'workflows/experimental/api').glob('*.json'))
        for path in paths:
            graph = json.loads(path.read_text())
            result = await execution.validate_prompt("cpu-validation", graph, None)
            if not result[0]:
                raise AssertionError(path.name + ": " + json.dumps(result, default=str))
            print("PASS native ComfyUI prompt validation: " + path.name, flush=True)

        controls = helpers.SwapControls()
        fast = controls.settings("fast_6_steps", 64, 96, 20, 81, 0, 123, 1)
        slow = controls.settings("undistilled_40_steps", 64, 96, 20, 81, 0, 123, 1)
        assert fast[5:9] == (6, 1.0, 0.8, 1)
        assert slow[5:9] == (40, 5.0, 0.0, 1)
        dummy_model = object()
        assert helpers.SwapOptionalLoRA().apply(dummy_model, "None", 1)[0] is dummy_model

        source = torch.ones((80, 64, 32, 3))
        images, length, count, _ = helpers.SwapPrepareShot().prepare(source, 64, 96)
        assert tuple(images.shape) == (81, 96, 64, 3) and length == 81 and count == 80
        assert images[:, :, :8].sum() == 0 and torch.allclose(images[:, :, 8:56], torch.ones((81, 96, 48, 3)))
        decoded = torch.arange(81, dtype=torch.float32)[:, None, None, None].expand(81, 96, 64, 3).clone() / 81
        audio = {"waveform": torch.arange(5000, dtype=torch.float32).reshape(1, 1, -1), "sample_rate": 1000}
        new, aligned, context_frames = helpers.SwapFinalizeShot().finish(decoded, 80, 5, 20, audio)
        assert len(new) == 75 and len(context_frames) == 80
        assert aligned["waveform"].shape[-1] == 3750 and aligned["waveform"][0, 0, 0] == 250
        assert torch.equal(context_frames[-1], decoded[79])
        saved = helpers.SwapSaveContext().save(context_frames, 20, 0)
        context = saved["result"][0]
        restored, offset, trim = helpers.SwapLoadContext().load(context, 64, 96, 20, 75)
        assert offset == trim == 5 and torch.equal(restored, context_frames[-5:])
        assert helpers.SwapLoadContext().load("", 64, 96, 20, 0) == (None, 0, 0)
        short_audio = {"waveform": torch.zeros(1, 1, 100), "sample_rate": 1000}
        assert helpers.slice_audio(short_audio, 20, 5, 75) is None
        viggle_images, source_count, anchor = helpers.RecastViggleSource().prepare(torch.ones((120, 64, 32, 3)), 64, 96)
        assert tuple(viggle_images.shape) == (124, 96, 64, 3) and source_count == 120
        assert tuple(anchor.shape) == (1, 96, 64, 3)
        assert torch.equal(viggle_images[-1], viggle_images[119])
        assert torch.equal(anchor[0], viggle_images[0])
        # A 125-frame job needs a full end-aligned second window starting at
        # frame 17, not the previous window's tail at 119. Pin only its first
        # five pixels/two H3 latents and discard all 107 accepted overlap frames.
        from comfy.nested_tensor import NestedTensor
        decoded = torch.arange(124, dtype=torch.float32)[:, None, None, None].expand(124, 96, 64, 3).clone() / 124
        receipt = helpers.RecastViggleSaveContext().save(decoded, 24, 0, 17, 'cpu-long-video')
        info = receipt['ui']['context'][0]
        assert info['source_count'] == 124 and info['source_anchor_frame'] == 17
        assert info['artifact']['type'] == 'output'
        stored = helpers.load_file(str(helpers.context_file(info['path'])))['frames']
        assert torch.equal(stored, decoded[17:22])
        class AnchorVAE:
            def encode(self, frames):
                assert torch.equal(frames, decoded[17:22])
                return torch.full((1, 24, 2, 6, 4), float(frames[0, 0, 0, 0]))
        original = {'samples': NestedTensor((torch.zeros(1, 24, 37, 6, 4), torch.zeros(1, 32, 2, 207)))}
        anchor_node = helpers.RecastViggleAnchor()
        anchored = anchor_node.anchor(original, AnchorVAE(), info['path'], 64, 96, 24, 17, 107, 'cpu-long-video')[0]
        video_latent, audio_latent = anchored['samples'].unbind()
        video_mask, audio_mask = anchored['noise_mask'].unbind()
        assert torch.allclose(video_latent[:, :, :2], torch.full_like(video_latent[:, :, :2], 17 / 124))
        assert video_latent[:, :, 2:].count_nonzero() == 0 and audio_latent.count_nonzero() == 0
        assert video_mask[:, :, :2].count_nonzero() == 0 and (video_mask[:, :, 2:] == 1).all()
        assert (audio_mask == 1).all() and original['samples'].unbind()[0].count_nonzero() == 0
        for changed in [dict(job_id='different-run'), dict(skip_frames=18), dict(overlap=5), dict(width=96), dict(fps=16)]:
            args = dict(latent=original, vae=AnchorVAE(), context_path=info['path'], width=64, height=96, fps=24, skip_frames=17, overlap=107, job_id='cpu-long-video')
            args.update(changed)
            try:
                anchor_node.anchor(**args)
            except ValueError:
                pass
            else:
                raise AssertionError('Mismatched anchor was accepted: ' + repr(changed))
        final, _, _ = helpers.SwapFinalizeShot().finish(decoded, 108, 107, 24)
        assert len(final) == 1 and torch.equal(final[0], decoded[107])
        print('PASS Viggle continuation: exact end-aligned anchor, native nested noise mask, immutable input and wrong-run/offset rejection', flush=True)
        for next_start in (119, 17):
            receipt = helpers.RecastViggleSaveContext().save(decoded, 24, 0, next_start, 'cpu-last-frame', 'last-frame-v2')
            info = receipt['ui']['context'][0]
            reference = helpers.RecastViggleContextReference().reference(info['path'], 64, 96, 24, next_start, 124 - next_start, 'cpu-last-frame')[0]
            assert torch.equal(reference, decoded[-1:])
            payload = helpers.load_file(str(helpers.context_file(info['path'])))
            assert ('reference_frame' in payload) == (next_start != 119)
            assert torch.equal(payload['frames'], decoded[next_start:next_start + 5])
            class ChainedVAE:
                def encode(self, frames):
                    assert torch.equal(frames, decoded[next_start:next_start + 5])
                    return torch.zeros((1, 24, 2, 6, 4))
            anchor_node.anchor(original, ChainedVAE(), info['path'], 64, 96, 24, next_start, 124 - next_start, 'cpu-last-frame', 'last-frame-v2')
            try:
                helpers.RecastViggleContextReference().reference(info['path'], 64, 96, 24, next_start, 124 - next_start, 'wrong-run')
            except ValueError:
                pass
            else:
                raise AssertionError('An unrelated run supplied the last-frame appearance reference.')
        print('PASS previous-frame appearance: exact last accepted frame for 5/107-frame overlaps, unchanged motion anchors, no duplicated checkpoint pixels for normal overlap', flush=True)
        print("PASS helper execution: presets, optional LoRA, geometry, tail padding, exact context, overlap and audio", flush=True)
        print('PASS Viggle tensor execution: source fitting, 120→124 padding, exact export count and source-frame anchor', flush=True)
        destination = torch.rand((1, 64, 96, 3))
        replacement = torch.ones_like(destination)
        mask = torch.zeros((1, 64, 96)); mask[:, 12:50, 20:70] = 1
        compositor = nodes.NODE_CLASS_MAPPINGS['ImageCompositeMasked']()
        composite = getattr(compositor, compositor.FUNCTION)(destination, replacement, 0, 0, False, mask)[0]
        assert torch.equal(composite[mask == 0], destination[mask == 0])
        assert torch.equal(composite[mask == 1], replacement[mask == 1])
        print('PASS native image mask composition: unchanged scene outside mask, replacement inside', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--comfy-root", type=Path, required=True, help="A ComfyUI checkout with its dependencies installed in this Python environment")
    args = parser.parse_args()
    asyncio.run(validate(args.comfy_root.expanduser().resolve()))


if __name__ == "__main__":
    main()
