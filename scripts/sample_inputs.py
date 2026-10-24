#!/usr/bin/env python3
"""Install the small upstream demo inputs without overwriting user uploads."""

import argparse
import hashlib
import json
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path, required=True)
    args = parser.parse_args()
    args.input_dir.mkdir(parents=True, exist_ok=True)
    for item in json.loads((ROOT / "config/samples.lock.json").read_text())["files"]:
        destination = args.input_dir / item["destination"]
        if destination.exists():
            print("Keeping existing input: " + destination.name)
            continue
        with urllib.request.urlopen(item["url"], timeout=60) as response:
            body = response.read(item["size"] + 1)
        if len(body) != item["size"] or hashlib.sha256(body).hexdigest() != item["sha256"]:
            raise SystemExit("Sample input verification failed: " + destination.name)
        temporary = destination.with_suffix(destination.suffix + ".part")
        temporary.write_bytes(body)
        temporary.replace(destination)
        print("Installed upstream sample: " + destination.name)


if __name__ == "__main__":
    main()
