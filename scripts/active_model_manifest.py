"""Current provisioning; frozen historical catalogs stay byte-identical."""
import json
from model_manifest import ROOT, selected_manifest
from model_policy import active_model_ids, assert_downloadable


def download_manifest(files=None):
    files = sorted(active_model_ids()) if files is None else files
    assert_downloadable(files)
    return selected_manifest(files)


def default_download_manifest():
    motion = json.loads((ROOT / 'config/openjutsu-models.lock.json').read_text())
    files = [item['destination'] for item in motion['files'] if 'motion_transfer' not in item['destination']] + motion['shared']
    return download_manifest(files)
