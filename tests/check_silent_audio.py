#!/usr/bin/env python3
"""Exercise the actual pinned audio decoder with sound, silence and corrupt input."""

import argparse
import ast
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import torch


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("comfy_root", type=Path)
    args = parser.parse_args()
    utils = args.comfy_root / "custom_nodes/ComfyUI-VideoHelperSuite/videohelpersuite/utils.py"
    tree = ast.parse(utils.read_text())
    function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "get_audio")
    # Run the real decoder function without importing the node pack or its model loaders.
    namespace = {"subprocess": subprocess, "torch": torch, "re": re,
                 "ffmpeg_path": shutil.which("ffmpeg"), "ENCODE_ARGS": ("utf-8", "replace")}
    exec(compile(ast.Module(body=[function], type_ignores=[]), str(utils), "exec"), namespace)
    decode = namespace["get_audio"]
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        silent, sound, corrupt = root / "silent.mp4", root / "sound.mp4", root / "corrupt.mp4"
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                        "color=size=64x96:rate=16:duration=1", "-an", "-c:v", "libx264", str(silent)], check=True)
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(silent),
                        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1",
                        "-c:v", "copy", "-c:a", "aac", "-t", "1", str(sound)], check=True)
        result = decode(str(silent))
        assert tuple(result["waveform"].shape) == (1, 2, 0)
        result = decode(str(sound))
        assert result["waveform"].numel() > 40000 and result["sample_rate"] == 48000
        corrupt.write_bytes(b"invalid video data")
        try:
            decode(str(corrupt))
        except Exception as error:
            assert "failed to extract audio" in str(error)
        else:
            raise AssertionError("Corrupt media must still fail; only a missing audio stream is allowed.")
    print("PASS: silent video returns empty audio; real audio is retained; corrupt media still fails.")


if __name__ == "__main__":
    main()
