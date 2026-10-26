#!/usr/bin/env python3
"""Build editable Viggle graphs from the Studio compiler's exported API graphs.

First run: cd studio && npx tsx scripts/export-viggle.ts
The extra schema snapshot is extracted from the pinned node pack source. It is
not a claim that a live GPU has loaded these nodes or rendered successfully.
"""
import json
from pathlib import Path
from build_workflows import ui_graph
from check_workflows import check_api, check_ui

ROOT = Path(__file__).resolve().parents[1]
NOTES = '''# Viggle character replacement · experimental

Two inputs: a continuous source shot and a character photo. The auto workflow
repaints the first source frame with FLUX.2 Klein 4B (4 image steps), then Viggle
propagates the edit (3 video passes). The prepared workflow instead expects an
already edited frame from this exact shot and skips Klein entirely.

Start with 480 × 864, 24 fps, 120 frames (5 seconds), one main subject, no cuts.
Set the source frame cap in Load Video. Keep it between 5 and 124. Prepare Source
pads to H3's 17k+5 frame grid; Finalize trims padding back to the true duration.
Set the same canvas dimensions in Prepare Source and Viggle Conditioning.

Use Euler, BasicGuider / CFG 1, the full-rank Viggle DMD LoRA at 1, video/audio
shift 3, and exact ManualSigmas: 1, 0.8571428571428571, 0.6, 0. No additional
sigma transform. Four sigma points mean THREE forward passes. Do not attach
SCAIL/Wan style, DPO, relighting or generic acceleration LoRAs to this model.

Review the saved conditioning PNG: scale, screen position, face, clothing and
lighting must already be right before temporal propagation can preserve them.
The image prompt acts on preparation; the video uses fixed conditioning.

GPU validation and sub-three-minute performance are not yet established for
this quantized recipe. The publisher's 26 s result is BF16 on B200 and excludes
image editing; its optimized 5090 path is not publicly released. See
 docs/overnight-realism-plan-2026-10-26.md for the budget and validation protocol.
'''


def main():
    catalog = json.loads((ROOT / 'integration-snapshot/object-info.json').read_text())
    catalog.update(json.loads((ROOT / 'integration-snapshot/viggle-node-schemas.json').read_text()))
    for path in sorted((ROOT / 'workflows/experimental/api').glob('viggle*.json')):
        graph = json.loads(path.read_text())
        errors = check_api(graph, catalog, allow_missing_files=True)
        if errors:
            raise SystemExit('\n'.join(errors))
        layout = {}
        slots = {}
        for key in graph:
            n = int(key)
            col = 0 if n in (2, 4) else 1 if n == 3 else 2 if 100 <= n <= 104 else 3 if 105 <= n <= 112 else 4 if 113 <= n <= 120 else 5 if n in (20, 24, 25, 30, 35) else 6 if n in (31, 38, 40, 41, 42) else 7 if n in (43, 44) else 8
            row = slots.get(col, 0)
            layout[key] = {'pos': [col * 420, row * 360], 'title': graph[key]['_meta']['title']}
            slots[col] = row + 1
        ui = ui_graph(graph, layout, catalog, 'Viggle replacement')
        ui['nodes'][-1]['widgets_values'] = [NOTES]
        ui['extra']['recast_engine'] = 'viggle'
        ui['extra']['recast_validation'] = 'offline schemas only; live GPU benchmark pending'
        ui['groups'] = []
        for title, start, end, colour in [('01 Source and character', 0, 2, '#35586e'), ('02 Repaint the source frame', 2, 5, '#546741'), ('03 Viggle distilled video', 5, 8, '#654a73'), ('04 Saved outputs and reference', 8, 9, '#4a6650')]:
            members = [n for n in ui['nodes'][:-1] if start * 420 <= n['pos'][0] < end * 420]
            if not members:
                continue
            x = min(n['pos'][0] for n in members) - 20
            right = max(n['pos'][0] + n['size'][0] for n in members) + 20
            bottom = max(n['pos'][1] + n['size'][1] for n in members) + 25
            ui['groups'].append({'id': len(ui['groups']) + 1, 'title': title, 'bounding': [x, -65, right - x, bottom + 65], 'color': colour, 'font_size': 24, 'flags': {}})
        errors = check_ui(ui)
        if errors:
            raise SystemExit('\n'.join(errors))
        (ROOT / 'workflows/experimental' / path.name).write_text(json.dumps(ui, indent=2) + '\n')
        print(path.name + ': offline schema + editable wiring valid')


if __name__ == '__main__':
    main()
