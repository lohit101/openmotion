#!/usr/bin/env python3
"""Check the installed GPU runtime, model files and registered workflow nodes."""

import argparse
import json
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

from check_workflows import check_api
from download_models import valid_file
from resources import effective_ram_bytes


ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    checks = []

    def record(name, operation):
        try:
            detail = operation()
            checks.append({"check": name, "ok": True, "detail": detail})
        except Exception as error:
            checks.append({"check": name, "ok": False, "detail": str(error)})

    def gpu():
        import torch
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA is unavailable")
        if not (torch.version.cuda or "").startswith("13."):
            raise RuntimeError("This INT8 package expects PyTorch CUDA 13")
        x = torch.ones((64, 64), device="cuda", dtype=torch.float16)
        torch.mm(x, x)
        torch.cuda.synchronize()
        return {"name": torch.cuda.get_device_name(0), "torch": torch.__version__, "cuda": torch.version.cuda,
                "effective_system_RAM_GB": round(effective_ram_bytes() / 1e9, 2),
                "vram_GB": round(torch.cuda.get_device_properties(0).total_memory / 1e9, 2)}

    def models():
        manifest = json.loads((ROOT / "config/models.lock.json").read_text())
        bad = [item["destination"] for item in manifest["files"] if not valid_file(ROOT / "models" / item["destination"], item)]
        if bad:
            raise RuntimeError("Missing or unverified: " + ", ".join(bad))
        return "7 pinned model files, %.2f GB" % (manifest["total_bytes"] / 1e9)

    def schemas():
        port = json.loads((ROOT / "config/server.json").read_text())["port"]
        with urllib.request.urlopen("http://127.0.0.1:%d/object_info" % port, timeout=30) as response:
            catalog = json.load(response)
        errors = []
        for path in (ROOT / "workflows/api").glob("*.json"):
            errors += check_api(json.loads(path.read_text()), catalog)
        if errors:
            raise RuntimeError("; ".join(errors))
        return "Both workflows match the running server, including filenames and LoRA choices"

    def video():
        if not shutil.which("ffmpeg"):
            raise RuntimeError("ffmpeg is missing")
        return subprocess.check_output(["ffmpeg", "-version"], text=True).splitlines()[0]

    record("CUDA runtime", gpu)
    record("Model integrity", models)
    record("Video tools", video)
    record("Live workflow schemas", schemas)
    report = {"checks": checks, "generation_benchmarked_by_this_check": False,
              "note": "This health check does not render. Recorded example timings and visual limitations are in validation/gpu-report.json when available; benchmark a new host and shot separately."}
    benchmark = ROOT / "validation/gpu-report.json"
    if benchmark.exists():
        recorded = json.loads(benchmark.read_text())
        report["recorded_benchmark"] = {"path": str(benchmark), "checked_utc": recorded["checked_utc"],
                                        "hardware": recorded["hardware"], "scope": "Previously recorded example, not a render performed by this health check"}
    (ROOT / "state").mkdir(exist_ok=True)
    (ROOT / "state/doctor.json").write_text(json.dumps(report, indent=2) + "\n")
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        for item in checks:
            print(("PASS " if item["ok"] else "FAIL ") + item["check"] + ": " + str(item["detail"]))
    if not all(check["ok"] for check in checks):
        sys.exit(1)


if __name__ == "__main__":
    main()
