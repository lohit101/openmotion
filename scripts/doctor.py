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


def profile_schema_graph(graph, manifest):
    """Check a template against installed preset files without requiring inactive adapters."""
    graph = json.loads(json.dumps(graph))
    selected = {item['destination'] for item in manifest['files']}
    if '24' in graph and 'loras/' + graph['24']['inputs']['lora_name'] not in selected:
        natural = 'lightx2v_T2V_14B_cfg_step_distill_v2_lora_rank64_bf16.safetensors'
        if 'loras/' + natural in selected:
            graph['24']['inputs']['lora_name'] = natural
        else:
            graph['25']['inputs']['model'] = graph['24']['inputs']['model']
            del graph['24']
    return graph


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--runtime-only", action="store_true", help="Check the installation without requiring model downloads")
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
        manifest = json.loads((args.manifest or ROOT / "config/models.lock.json").read_text())
        bad = [item["destination"] for item in manifest["files"] if not valid_file(ROOT / "models" / item["destination"], item)]
        if bad:
            raise RuntimeError("Missing or unverified: " + ", ".join(bad))
        return "%d pinned model files, %.2f GB" % (len(manifest['files']), manifest["total_bytes"] / 1e9)

    def schemas():
        import server as recast_server
        install, _ = recast_server.configuration()
        recast_server.verify_runtime_source(install)
        port = json.loads((ROOT / "config/server.json").read_text())["port"]
        with urllib.request.urlopen("http://127.0.0.1:%d/object_info" % port, timeout=30) as response:
            catalog = json.load(response)
        errors = []
        # This tiny pinned node pack has no extra pip dependencies or weights.
        # Detect old cached engines before declaring the new recipe ready.
        for name in ('ViggleAnimateConditioning', 'ViggleTextCondLoader', 'RecastViggleSource', 'RecastViggleAnchor', 'RecastViggleSaveContext', 'RecastViggleContextReference', 'MiniMaxH3SigmaShift', 'Flux2Scheduler'):
            if name not in catalog:
                errors.append('Missing pinned runtime node: ' + name)
        paths = list((ROOT / 'workflows/api').glob('*.json'))
        if args.manifest:
            selected = {f['destination'] for f in json.loads(args.manifest.read_text())['files']}
            if any('viggle' in name for name in selected):
                preparation = 'auto' if any('flux-2-klein' in name for name in selected) else 'prepared'
                paths = [ROOT / ('workflows/experimental/api/viggle_int8_%s_swap.json' % preparation)]
        elif args.runtime_only:
            paths.extend((ROOT / 'workflows/experimental/api').glob('viggle*.json'))
        for path in paths:
            graph = json.loads(path.read_text())
            if args.manifest and 'experimental' not in path.parts:
                graph = profile_schema_graph(graph, json.loads(args.manifest.read_text()))
            # Model bytes/hashes are checked separately. Example input videos
            # and images need not exist for an engine or recipe health check.
            errors += check_api(graph, catalog, allow_missing_files=args.runtime_only or bool(args.manifest))
        if errors:
            raise RuntimeError("; ".join(errors))
        return ("Runtime workflow schemas match; model downloads are manual" if args.runtime_only else
                "Workflow schemas match; selected model files verified by manifest" if args.manifest else
                "Both workflows match the running server, including filenames and LoRA choices")

    def video():
        if not shutil.which("ffmpeg"):
            raise RuntimeError("ffmpeg is missing")
        return subprocess.check_output(["ffmpeg", "-version"], text=True).splitlines()[0]

    record("CUDA runtime", gpu)
    if not args.runtime_only:
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
