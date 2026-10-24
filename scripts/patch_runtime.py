#!/usr/bin/env python3
"""Apply the small, recorded compatibility fix to the pinned video loader."""

import argparse
import hashlib
import json
from pathlib import Path


SILENT_AUDIO_PATCH = '''        # character-swap: silent-video audio compatibility
        message = e.stderr.decode(*ENCODE_ARGS)
        if re.search(r"Output file (?:#0 )?does not contain any stream", message):
            return {"waveform": torch.empty((1, 2, 0), dtype=torch.float32), "sample_rate": 44100}
'''


def patch_video_audio(path):
    source = path.read_text()
    changed = SILENT_AUDIO_PATCH not in source
    if changed:
        lines = source.splitlines(keepends=True)
        matches = [i for i, line in enumerate(lines) if 'raise Exception(f"VHS failed to extract audio from {file}:' in line]
        if len(matches) != 1 or lines[matches[0] - 1].strip() != "except subprocess.CalledProcessError as e:":
            raise RuntimeError("Video loader differs from the pinned source; the silent-audio patch was not applied.")
        lines.insert(matches[0], SILENT_AUDIO_PATCH)
        source = "".join(lines)
        compile(source, str(path), "exec")
        temporary = path.with_suffix(".py.patch-tmp")
        temporary.write_text(source)
        temporary.replace(path)
    return {"patch": "vhs-silent-video-audio-v1", "file": str(path), "changed": changed,
            "patched_sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("comfy_root", type=Path)
    parser.add_argument("--state-dir", type=Path)
    args = parser.parse_args()
    report = patch_video_audio(args.comfy_root / "custom_nodes/ComfyUI-VideoHelperSuite/videohelpersuite/utils.py")
    if args.state_dir:
        args.state_dir.mkdir(parents=True, exist_ok=True)
        (args.state_dir / "runtime-patches.json").write_text(json.dumps([report], indent=2) + "\n")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
