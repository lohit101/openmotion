#!/usr/bin/env python3
"""Prepare the small local CPU reference-alignment tool without contacting a GPU."""

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
ENV = ROOT / ".local/geometry-venv"
PYTHON = ENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
STATE = ROOT / ".local/geometry-ready.json"
REQUIREMENTS = ROOT / "config/local-geometry-requirements.txt"
MANIFEST = ROOT / "config/geometry-model.lock.json"


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def model_entry():
    manifest = json.loads(MANIFEST.read_text())
    return manifest.get("model", manifest)


def model_path(item):
    filename = item.get("filename", "face_detection_yunet_2023mar.onnx")
    return ROOT / ".local/geometry-models" / Path(filename).name


def ready():
    try:
        item = model_entry()
        saved = json.loads(STATE.read_text())
        return PYTHON.is_file() and saved["requirementsSha256"] == digest(REQUIREMENTS) and saved["manifestSha256"] == digest(MANIFEST) and model_path(item).stat().st_size == item["size"] and digest(model_path(item)) == item["sha256"]
    except (OSError, KeyError, ValueError):
        return False


def install():
    if not (3, 9) <= sys.version_info[:2] <= (3, 13):
        raise ValueError("Local reference framing supports Python 3.9–3.13. Run this setup using one of those versions.")
    (ROOT / ".local").mkdir(exist_ok=True)
    with (ROOT / ".local/geometry-setup.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        license_dir = model_path(model_entry()).parent
        license_dir.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / 'licenses/yunet-MIT.txt', license_dir / 'yunet-MIT.txt')
        if ready():
            print("Local CPU reference framing is ready.")
            return
        if not PYTHON.is_file():
            subprocess.run([sys.executable, "-m", "venv", str(ENV)], check=True)
        print("Installing the small CPU reference-framing dependencies on this computer.", flush=True)
        subprocess.run([str(PYTHON), "-m", "pip", "install", "--disable-pip-version-check", "-r", str(REQUIREMENTS)], check=True)
        item = model_entry()
        destination = model_path(item)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if not destination.exists() or destination.stat().st_size != item["size"] or digest(destination) != item["sha256"]:
            temporary = destination.with_suffix(".part")
            try:
                with urllib.request.urlopen(item["url"], timeout=30) as response, temporary.open("wb") as output:
                    while True:
                        block = response.read(65536)
                        if not block:
                            break
                        output.write(block)
                        if output.tell() > item["size"]:
                            raise ValueError("Reference detector download exceeds its pinned size.")
                if temporary.stat().st_size != item["size"] or digest(temporary) != item["sha256"]:
                    raise ValueError("Reference detector checksum failed.")
                temporary.replace(destination)
            finally:
                temporary.unlink(missing_ok=True)
        subprocess.run([str(PYTHON), "-c", "import cv2,numpy,sys; cv2.FaceDetectorYN.create(sys.argv[1], '', (320,320)); print('CPU face detector loaded:', cv2.__version__)", str(destination)], check=True)
        temporary = STATE.with_suffix(".tmp")
        temporary.write_text(json.dumps({"requirementsSha256": digest(REQUIREMENTS), "manifestSha256": digest(MANIFEST), "modelSha256": item["sha256"]}, indent=2) + "\n")
        temporary.replace(STATE)
        print("Local CPU reference framing is ready. No GPU connection or rental was used.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.check:
        if not ready():
            raise ValueError("Local reference framing is not ready. Run python3 scripts/setup_local_geometry.py before connecting or renting a GPU.")
        print(json.dumps({"ready": True, "gpuContacted": False}))
    else:
        install()


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        raise SystemExit(str(error)) from error
