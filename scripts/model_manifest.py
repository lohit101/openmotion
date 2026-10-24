"""Select pinned model files without changing their revisions or checksums."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def selected_manifest(files=None):
    available = []
    for name in ('models.lock.json', 'optional-models.lock.json', 'natural-models.lock.json'):
        available.extend(json.loads((ROOT / 'config' / name).read_text())['files'])
    if files is None:
        files = [item['destination'] for item in available]
    if not isinstance(files, list) or not all(isinstance(name, str) for name in files):
        raise ValueError('Model selection must be a list of pinned destinations.')
    known = {item['destination'] for item in available}
    if len(set(files)) != len(files) or not set(files).issubset(known):
        raise ValueError('Unknown or duplicate setup model. Only pinned files can be downloaded automatically.')
    selected = [item for item in available if item['destination'] in files]
    return {'total_bytes': sum(item['size'] for item in selected), 'files': selected}


def manifest_path(remote_root, manifest):
    key = hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()[:20]
    return str(Path(remote_root) / 'state/model-plans' / (key + '.json'))


def write_remote_manifest(config, manifest):
    import vast
    target = manifest_path(config['remote_root'], manifest)
    code = ('import json,sys;from pathlib import Path;'
            'p=Path(sys.argv[1]);p.parent.mkdir(parents=True,exist_ok=True);'
            't=p.with_suffix(".tmp");t.write_text(json.dumps(json.loads(sys.argv[2]),indent=2)+"\\n");t.replace(p)')
    vast.remote(config, ['python3', '-c', code, target, json.dumps(manifest)])
    return target
