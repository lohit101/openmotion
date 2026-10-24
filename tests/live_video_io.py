#!/usr/bin/env python3
"""Exercise uploads, two short API passes, continuation and audio without loading models."""

import argparse
import importlib.util
import json
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8199")
    args = parser.parse_args()
    spec = importlib.util.spec_from_file_location("swap_client", ROOT / "scripts/render_clip.py")
    client = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(client)
    with tempfile.TemporaryDirectory() as temporary:
        temporary = Path(temporary)
        source = temporary / "source.mp4"
        reference = temporary / "reference.png"
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=64x96:rate=16",
                        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000", "-t", "6", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(source)], check=True)
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(source), "-frames:v", "1", str(reference)], check=True)
        graph = json.loads((ROOT / "workflows/api/scail2_int8_swap.json").read_text())
        # Only the source, bookkeeping and export are ancestors of an output.
        # Model nodes remain disconnected and are never executed.
        graph.pop("12")
        graph.pop("13")
        graph["45"]["inputs"]["images"] = ["3", 0]
        selected = temporary / "workflows/api"
        selected.mkdir(parents=True)
        (selected / "scail2_int8_swap.json").write_text(json.dumps(graph))
        client.ROOT = temporary
        sys.argv = ["io-test", "--source", str(source), "--reference", str(reference), "--seconds", "5.875",
                    "--width", "64", "--height", "96", "--fps", "16", "--prompt", "Synthetic video I/O test", "--url", args.url]
        client.main()
        state_file = next((temporary / "outputs/batches").glob("*/run.json"))
        state = json.loads(state_file.read_text())
        assert state["completed_frames"] == 94
        assert [item["new_frames"] for item in state["segments"]] == [81, 13]
        result = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-count_frames", "-show_entries",
                                                    "stream=codec_type,nb_read_frames,duration", "-of", "json", state["final_video"]]))
        video = next(stream for stream in result["streams"] if stream["codec_type"] == "video")
        audio = next(stream for stream in result["streams"] if stream["codec_type"] == "audio")
        assert int(video["nb_read_frames"]) == 94
        assert abs(float(video["duration"]) - 5.875) < 0.02
        assert abs(float(audio["duration"]) - 5.875) < 0.1
        print("PASS live API video I/O: uploads, 81+13 unique frames, context resume, MP4 export and original audio assembly")


if __name__ == "__main__":
    main()
