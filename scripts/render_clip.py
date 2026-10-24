#!/usr/bin/env python3
"""Optional API client for sequential, resumable short passes of one continuous shot."""

import argparse
import hashlib
import http.client
import importlib.util
import json
import math
import mimetypes
import shlex
import shutil
import subprocess
import time
import urllib.parse
import urllib.request
import uuid
from datetime import datetime
from pathlib import Path
from prompting import compile_prompt


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("swap_rules", ROOT / "custom_nodes/character_swap_helpers/logic.py")
rules = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rules)


def request_json(url, route, value=None):
    body = None if value is None else json.dumps(value).encode()
    request = urllib.request.Request(url.rstrip("/") + route, data=body,
                                     headers={"Content-Type": "application/json"} if body else {})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError("ComfyUI HTTP %d: %s" % (error.code, error.read(8000).decode(errors="replace"))) from error


def upload(url, path, prefix):
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("Use the local SSH tunnel's HTTP URL or an HTTPS URL")
    filename = prefix + path.suffix.lower()
    boundary = "character-swap-" + uuid.uuid4().hex
    content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    first = ('--%s\r\nContent-Disposition: form-data; name="image"; filename="%s"\r\nContent-Type: %s\r\n\r\n' % (boundary, filename, content_type)).encode()
    last = ('\r\n--%s\r\nContent-Disposition: form-data; name="type"\r\n\r\ninput\r\n--%s--\r\n' % (boundary, boundary)).encode()
    cls = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
    connection = cls(parsed.hostname, parsed.port, timeout=120)
    try:
        connection.putrequest("POST", parsed.path.rstrip("/") + "/upload/image")
        connection.putheader("Content-Type", "multipart/form-data; boundary=" + boundary)
        connection.putheader("Content-Length", str(len(first) + path.stat().st_size + len(last)))
        connection.endheaders()
        connection.send(first)
        with path.open("rb") as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                connection.send(block)
        connection.send(last)
        response = connection.getresponse()
        raw = response.read()
        if response.status != 200:
            raise RuntimeError("Upload failed: " + raw.decode(errors="replace")[:2000])
        value = json.loads(raw)
        return "/".join(part for part in [value.get("subfolder", ""), value["name"]] if part)
    finally:
        connection.close()


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def save_state(path, state):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(state, indent=2) + "\n")
    temporary.replace(path)


def wait_for_job(url, prompt_id, timeout):
    deadline = time.monotonic() + timeout
    reported, absent = 0, 0
    while time.monotonic() < deadline:
        history = request_json(url, "/history/" + prompt_id)
        if prompt_id in history:
            result = history[prompt_id]
            if result.get("status", {}).get("status_str") == "error":
                raise RuntimeError("Generation failed:\n" + json.dumps(result.get("status"), indent=2))
            return result
        queue = request_json(url, "/queue")
        ids = {entry[1] for field in ["queue_running", "queue_pending"] for entry in queue.get(field, [])}
        absent = absent + 1 if prompt_id not in ids else 0
        if absent >= 5:
            raise RuntimeError("The saved job is absent from this server's queue/history. Resume with --retry-missing-job only after confirming it was lost on restart.")
        if time.monotonic() - reported > 20:
            print("Waiting for segment " + prompt_id, flush=True)
            reported = time.monotonic()
        time.sleep(2)
    raise RuntimeError("Wait timed out. The GPU job was left running; resume this run to keep waiting.")


def download_video(url, entry, destination):
    query = urllib.parse.urlencode({"filename": entry["filename"], "subfolder": entry.get("subfolder", ""), "type": entry.get("type", "output")})
    temporary = destination.with_suffix(".part")
    with urllib.request.urlopen(url.rstrip("/") + "/view?" + query, timeout=120) as response, temporary.open("wb") as stream:
        shutil.copyfileobj(response, stream)
    temporary.replace(destination)


def choose_path(label):
    value = input(label + ": ").strip()
    try:
        parts = shlex.split(value)
        if len(parts) == 1:
            value = parts[0]
    except ValueError:
        pass
    path = Path(value).expanduser().resolve()
    if not path.is_file():
        raise ValueError("File not found: " + str(path))
    return path


def finish_video(state, directory):
    if not shutil.which("ffmpeg"):
        raise RuntimeError("Segments are saved. Install local ffmpeg and resume to assemble the final video.")
    # All filenames are generated here, so the concat list never contains user text.
    listing = directory / "segments.txt"
    # Remove each segment's AAC preroll before concatenating video packets.
    # Otherwise FFmpeg's concat demuxer can shift video by one AAC packet.
    entries = []
    for index in range(len(state["segments"])):
        video = directory / ("video_%04d.mp4" % index)
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "warning", "-y", "-i",
                        str(directory / ("segment_%04d.mp4" % index)), "-map", "0:v:0",
                        "-an", "-c:v", "copy", "-movflags", "+faststart", str(video)], check=True)
        entries.append("file 'video_%04d.mp4'\n" % index)
    listing.write_text("".join(entries))
    duration = state["completed_frames"] / state["settings"]["fps"]
    output = directory / "final.mp4"
    command = ["ffmpeg", "-hide_banner", "-loglevel", "warning", "-y", "-f", "concat", "-safe", "0", "-i", str(listing),
               "-ss", str(state["settings"]["start_seconds"]), "-i", state["source"],
               "-map", "0:v:0", "-map", "1:a:0?", "-c:v", "copy", "-c:a", "aac", "-ar", "48000", "-b:a", "192k",
               "-t", str(duration), "-movflags", "+faststart", str(output)]
    subprocess.run(command, check=True)
    state["final_video"] = str(output)
    save_state(directory / "run.json", state)
    print("Finished: " + str(output))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path)
    parser.add_argument("--reference", type=Path)
    parser.add_argument("--seconds", type=float)
    parser.add_argument("--start", type=float, default=0)
    parser.add_argument("--prompt", default="", help="Optional finished-video details; scene-preserving defaults are always included.")
    parser.add_argument("--url", default="http://127.0.0.1:8188")
    parser.add_argument("--width", type=int, default=480)
    parser.add_argument("--height", type=int, default=832)
    parser.add_argument("--fps", type=float, default=16)
    parser.add_argument("--seed", type=int, default=20261024)
    parser.add_argument("--preset", choices=["fast_6_steps", "undistilled_40_steps"], default="fast_6_steps")
    parser.add_argument("--source-person", default="person")
    parser.add_argument("--reference-person", default="person")
    parser.add_argument("--object-indices", default="0")
    parser.add_argument("--lora-a", default="None")
    parser.add_argument("--lora-a-strength", type=float, default=0.8)
    parser.add_argument("--lora-b", default="None")
    parser.add_argument("--lora-b-strength", type=float, default=0.8)
    parser.add_argument("--resume", type=Path)
    parser.add_argument("--retry-missing-job", action="store_true")
    parser.add_argument("--timeout", type=int, default=7200)
    args = parser.parse_args()
    template_path = ROOT / "workflows/api/scail2_int8_swap.json"
    template = json.loads(template_path.read_text())
    if args.resume:
        directory = args.resume.expanduser().resolve()
        if directory.is_file():
            directory = directory.parent
        state = json.loads((directory / "run.json").read_text())
        if digest(Path(state["source"])) != state["source_sha256"] or digest(Path(state["reference"])) != state["reference_sha256"]:
            raise ValueError("Inputs changed since this run; start a new run.")
        if state["workflow_sha256"] != digest(template_path):
            raise ValueError("Workflow changed since this run; finish it with the original workflow or start a new run.")
        if args.retry_missing_job and state.get("pending"):
            queue = request_json(args.url, "/queue")
            active = {entry[1] for field in ["queue_running", "queue_pending"] for entry in queue.get(field, [])}
            history = request_json(args.url, "/history/" + state["pending"]["id"])
            if state["pending"]["id"] not in active and state["pending"]["id"] not in history:
                state["pending"] = None
    else:
        source = args.source.expanduser().resolve() if args.source else choose_path("Source video path")
        reference = args.reference.expanduser().resolve() if args.reference else choose_path("Character reference image path")
        if not source.is_file() or not reference.is_file():
            raise ValueError("Source video and reference image must exist.")
        seconds = args.seconds if args.seconds is not None else float(input("Seconds to render: "))
        if args.fps <= 0 or seconds * args.fps < 5 or args.start < 0:
            raise ValueError("Choose a positive frame rate and at least five source frames.")
        rules.dimensions(args.width, args.height)
        prompt = compile_prompt(args.prompt)
        settings = {"width": args.width, "height": args.height, "fps": args.fps, "seed": args.seed,
                    "preset": args.preset, "start_seconds": math.floor(args.start * args.fps) / args.fps,
                    "source_person": args.source_person, "reference_person": args.reference_person,
                    "object_indices": args.object_indices, "prompt": prompt,
                    "lora_a": args.lora_a, "lora_a_strength": args.lora_a_strength,
                    "lora_b": args.lora_b, "lora_b_strength": args.lora_b_strength}
        identifier = datetime.now().strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]
        directory = ROOT / "outputs/batches" / identifier
        directory.mkdir(parents=True)
        state = {"source": str(source), "reference": str(reference), "source_sha256": digest(source),
                 "reference_sha256": digest(reference), "workflow_sha256": digest(template_path),
                 "settings": settings, "target_frames": math.ceil(seconds * args.fps), "completed_frames": 0,
                 "context": "", "segments": [], "pending": None, "uploads": {}}
    state_path = directory / "run.json"
    save_state(state_path, state)
    print("Run state: " + str(state_path), flush=True)
    if not state["uploads"]:
        identifier = uuid.uuid4().hex[:16]
        state["uploads"] = {"source": upload(args.url, Path(state["source"]), identifier + "-source"),
                            "reference": upload(args.url, Path(state["reference"]), identifier + "-reference")}
        save_state(state_path, state)
    while state["completed_frames"] < state["target_frames"]:
        if not state.get("pending"):
            plan = rules.next_segment(state["completed_frames"], state["target_frames"])
            prompt = json.loads(json.dumps(template))
            settings = state["settings"]
            prompt["1"]["inputs"].update({name: settings[name] for name in ["width", "height", "fps", "seed", "preset"]})
            prompt["1"]["inputs"].update({"frame_cap": plan["frame_cap"], "skip_frames": round(settings["start_seconds"] * settings["fps"]) + plan["skip_frames"]})
            prompt["2"]["inputs"]["video"] = state["uploads"]["source"]
            prompt["4"]["inputs"]["image"] = state["uploads"]["reference"]
            prompt["7"]["inputs"]["text"] = settings["source_person"]
            prompt["8"]["inputs"]["text"] = settings["reference_person"]
            prompt["11"]["inputs"]["object_indices"] = settings["object_indices"]
            prompt["31"]["inputs"]["text"] = settings["prompt"]
            prompt["36"]["inputs"]["context_path"] = state["context"]
            for node, suffix in [("22", "a"), ("23", "b")]:
                prompt[node]["inputs"].update({"lora_name": settings["lora_" + suffix], "strength_model": settings["lora_" + suffix + "_strength"]})
            prompt["46"]["inputs"]["filename_prefix"] = "character_swap/batches/%s/segment_%04d" % (directory.name, len(state["segments"]))
            response = request_json(args.url, "/prompt", {"prompt": prompt, "client_id": "character-swap-" + directory.name})
            if response.get("node_errors") or "prompt_id" not in response:
                raise RuntimeError(json.dumps(response, indent=2))
            state["pending"] = {"id": response["prompt_id"], "submitted": time.time(), "plan": plan}
            save_state(state_path, state)
        history = wait_for_job(args.url, state["pending"]["id"], args.timeout)
        outputs = history["outputs"]
        context = outputs["47"]["context"][0]
        files = [entry for entry in outputs["46"].get("gifs", []) if entry["filename"].endswith(".mp4")]
        if not files:
            raise RuntimeError("The generation returned no MP4; inspect its history.")
        segment = directory / ("segment_%04d.mp4" % len(state["segments"]))
        download_video(args.url, files[-1], segment)
        added = context["source_count"] - state["pending"]["plan"]["overlap"]
        if added <= 0:
            raise RuntimeError("Source ended before this segment could add any frames.")
        state["segments"].append({"file": segment.name, "new_frames": added, "prompt_id": state["pending"]["id"],
                                  "elapsed_seconds": round(time.time() - state["pending"]["submitted"], 2)})
        state["completed_frames"] += added
        state["context"] = context["path"]
        cap = state["pending"]["plan"]["frame_cap"]
        state["pending"] = None
        if context["source_count"] < cap:
            state["target_frames"] = state["completed_frames"]
        save_state(state_path, state)
        print("Completed %d/%d frames" % (state["completed_frames"], state["target_frames"]), flush=True)
    finish_video(state, directory)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error))
