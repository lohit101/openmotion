#!/usr/bin/env python3
"""Check graph wiring and the actual installed ComfyUI node schemas."""

import argparse
import json
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def linked(value):
    return isinstance(value, list) and len(value) == 2 and isinstance(value[0], str) and isinstance(value[1], int)


def check_api(graph, catalog, allow_missing_files=False):
    errors, visiting, visited = [], set(), set()

    def visit(key):
        if key in visiting:
            errors.append("Cycle at node " + key)
            return
        if key in visited or key not in graph:
            return
        visiting.add(key)
        for value in graph[key]["inputs"].values():
            if linked(value):
                visit(value[0])
        visiting.remove(key)
        visited.add(key)

    for key, node in graph.items():
        kind = node["class_type"]
        schema = catalog.get(kind)
        if schema is None:
            errors.append("Missing installed node: " + kind)
            continue
        required = schema["input"].get("required", {})
        fields = dict(required, **schema["input"].get("optional", {}))
        if kind == "VHS_VideoCombine":
            formats = required["format"][1]["formats"]
            for entry in formats.get(node["inputs"].get("format"), []):
                fields[entry[0]] = entry[1:]
        for name in required:
            if name not in node["inputs"]:
                errors.append("%s: missing %s" % (key, name))
        for name, value in node["inputs"].items():
            if name not in fields:
                errors.append("%s: unknown input %s" % (key, name))
                continue
            definition = fields[name]
            expected = definition[0]
            options = definition[1] if len(definition) > 1 else {}
            if linked(value):
                parent = graph.get(value[0])
                if parent is None:
                    errors.append("%s.%s: dangling link" % (key, name))
                    continue
                source = catalog.get(parent["class_type"], {}).get("output", [])
                if not 0 <= value[1] < len(source):
                    errors.append("%s.%s: invalid output slot" % (key, name))
                    continue
                actual = source[value[1]]
                if not isinstance(expected, list) and expected != "*" and actual not in expected.split(","):
                    errors.append("%s.%s: expected %s, linked %s" % (key, name, expected, actual))
            elif isinstance(expected, list):
                if value not in expected and not (allow_missing_files and (not expected or name in ("video", "image", "clip_name", "unet_name", "vae_name", "ckpt_name", "lora_name"))):
                    errors.append("%s.%s: value not available: %s" % (key, name, value))
            elif expected in ("INT", "FLOAT"):
                if isinstance(value, bool) or not isinstance(value, (int, float)) or (expected == "INT" and not isinstance(value, int)):
                    errors.append("%s.%s: wrong numeric type" % (key, name))
                elif ("min" in options and value < options["min"]) or ("max" in options and value > options["max"]):
                    errors.append("%s.%s: outside allowed range" % (key, name))
            elif expected == "BOOLEAN" and not isinstance(value, bool):
                errors.append("%s.%s: expected boolean" % (key, name))
        visit(key)
    return errors


def check_ui(graph):
    errors = []
    nodes = {node["id"]: node for node in graph["nodes"]}
    seen = set()
    for lid, source, slot, target, target_slot, kind in graph["links"]:
        if lid in seen:
            errors.append("Duplicate UI link %s" % lid)
        seen.add(lid)
        try:
            origin = nodes[source]["outputs"][slot]
            destination = nodes[target]["inputs"][target_slot]
            if lid not in origin["links"] or destination["link"] != lid or origin["type"] != kind:
                errors.append("Mismatched UI link %s" % lid)
        except (KeyError, IndexError):
            errors.append("Dangling UI link %s" % lid)
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default=None)
    parser.add_argument("--allow-missing-files", action="store_true")
    args = parser.parse_args()
    if args.url:
        with urllib.request.urlopen(args.url.rstrip("/") + "/object_info", timeout=30) as response:
            catalog = json.load(response)
    else:
        catalog = json.loads((ROOT / "config/node-schema.json").read_text())
    failures = []
    for path in sorted((ROOT / "workflows/api").glob("*.json")):
        errors = check_api(json.loads(path.read_text()), catalog, args.allow_missing_files or not args.url)
        errors += check_ui(json.loads((ROOT / "workflows" / path.name).read_text()))
        failures.extend(path.name + ": " + error for error in errors)
        print(path.name + (": schema and wiring OK" if not errors else ": FAILED"))
    if failures:
        raise SystemExit("\n".join(failures))


if __name__ == "__main__":
    main()
