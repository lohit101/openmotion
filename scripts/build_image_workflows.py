#!/usr/bin/env python3
"""Build editable Klein image workflows from the Studio compiler exports."""
import json
from pathlib import Path
from build_workflows import ui_graph
from check_workflows import check_api, check_ui

ROOT = Path(__file__).resolve().parents[1]
NOTES = '''# Klein image replacement

Image one is the target photograph: pose, camera distance, screen placement,
scale and scene lighting. Image two is the identity reference: face, hair,
outfit and accessories. The baseline uses the three shared Klein image models.
Four image steps, Euler, CFG 1. No video models are required.
The optional identity workflow additionally requires the matching 370 MB BFS
Klein 4B head adapter and adds a separate four-step facial pass. It takes a
clear face.png and source-aligned face-refine-mask.png on the working canvas.
Export a prepared Studio job for actual detector-derived mask inputs.

These portable examples use a 1024 x 1024 target. For a different target, set
latent/scheduler/crop/export dimensions consistently. Studio automatically
pads to the model grid without cropping and exports the original dimensions.
Export an actual Studio job for its exact canvas, prepared inputs and optional
third face reference. The native graph uses those uploaded input filenames.

The masked workflow takes a grayscale edit-mask.png: white replaces, black
preserves. Supply the same target in both target loaders. Preserve foreground
occlusions by leaving them black. A mask constrains changed pixels; it is not
a face identity guarantee. Studio feathers inward and restores exact original
decoded pixels outside the mask after the GPU image is saved.

Review facial features and head scale/placement before using the image in a
video. No face beautification or face restoration is applied. Model quality
must be checked on the actual reference; a seed is not an identity lock.
'''


def main():
    catalog = json.loads((ROOT / 'integration-snapshot/object-info.json').read_text())
    catalog.update(json.loads((ROOT / 'integration-snapshot/viggle-node-schemas.json').read_text()))
    catalog.update(json.loads((ROOT / 'integration-snapshot/qwen21-node-schemas.json').read_text()))
    for file in sorted((ROOT / 'workflows/experimental/api').glob('*_image_*.json')):
        graph = json.loads(file.read_text())
        errors = check_api(graph, catalog, allow_missing_files=True)
        if errors:
            raise SystemExit('\n'.join(errors))
        layout, rows = {}, {}
        for key, node in graph.items():
            n = int(key)
            col = 0 if n in (1, 4, 122, 128, 129) else 1 if n in (102, 103, 104) else 2 if n in (105, 106, 107, 108, 123) else 3 if n in (109, 110, 111, 112, 124, 125) else 4 if n in (113, 114, 115, 116, 117) else 5 if n in (118, 119) else 6
            layout[key] = {'pos': [col * 420, rows.get(col, 0) * 420], 'title': node['_meta']['title']}
            rows[col] = rows.get(col, 0) + 1
        qwen = file.name.startswith('qwen21_')
        ui = ui_graph(graph, layout, catalog, 'Qwen trained whole-person replacement' if qwen else 'Klein photographic character replacement')
        qwen_notes = '''# Qwen Image 2.1 whole-person replacement · evaluation candidate

Image one is the base photograph: scene, pose, lighting, camera distance and framing.
Image two supplies the complete replacement person, facial identity and outfit.
The matching BFS body adapter and official eight-step accelerator are required.
Use Qwen 2.1 INT8, its Qwen3-VL 8B encoder and matching RGBA VAE; Klein files
are incompatible. The complete image stack is 18.41 GB. No prompt enhancer is required.

Eight steps, Euler/simple, CFG 1, native reference-prefix cache with default precision.
Use a clear full-body reference on a plain light background, about 0.59 MP.
The base scene stays first and its native latent output sizes the generation.
Split RGBA to RGB before compositing. Paint the person and preserve occlusions.
Review identity, pose and scene lighting; GPU quality and timing are not yet measured.
Base Qwen components use the Qwen Research License; the BFS adapter is MIT.
'''
        ui['nodes'][-1]['widgets_values'] = [qwen_notes if qwen else NOTES]
        ui['extra']['recast_engine'] = 'qwen21-image' if qwen else 'klein-image'
        errors = check_ui(ui)
        if errors:
            raise SystemExit('\n'.join(errors))
        (ROOT / 'workflows/experimental' / file.name).write_text(json.dumps(ui, indent=2) + '\n')
        print(file.name + ': API and editable wiring valid')


if __name__ == '__main__':
    main()
