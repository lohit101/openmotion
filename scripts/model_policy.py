"""The same active download catalog used by Studio, including shared files."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def active_model_ids():
    policy = json.loads((ROOT / 'config/active-models.json').read_text())
    if policy.get('version') != 1 or len(set(policy['files'])) != len(policy['files']):
        raise ValueError('Invalid active model catalog.')
    return frozenset(policy['files'])


def assert_downloadable(files):
    retired = set(files) - active_model_ids()
    if retired:
        raise ValueError('Retired workflow files cannot be downloaded: ' + ', '.join(sorted(retired)))
