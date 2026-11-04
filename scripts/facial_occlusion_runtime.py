"""Explicit preparation for the versioned hand/partial-face tracking runtime.

Weights remain in the normal pinned model downloader. This module never starts
compute, downloads weights, or changes the ComfyUI Python environment.
"""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
FILES = [
    'config/facial-consistency-occlusion.lock.json',
    'config/facial-consistency-occlusion-models.lock.json',
    'config/facial-consistency-occlusion-runtime.lock.json',
    'scripts/face_partial_source.py', 'scripts/face_occlusion_tracking.py',
    'scripts/face_occlusion_finish.py',
    'scripts/facial_occlusion_runtime.py',
    'scripts/face_occlusion_vendor/__init__.py',
    'scripts/face_occlusion_vendor/mp_palmdet.py',
    'scripts/face_occlusion_vendor/mp_handpose.py',
    'scripts/face_occlusion_vendor/crop.py',
    'scripts/face_occlusion_vendor/LICENSE.opencv-zoo',
    'scripts/face_occlusion_vendor/LICENSE.performrecast',
    'scripts/face_occlusion_vendor/provenance.json',
]


def digest(file):
    value = hashlib.sha256()
    with Path(file).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def settings():
    return json.loads((ROOT / 'config/facial-consistency-occlusion-runtime.lock.json').read_text())


def source_root():
    return ROOT / '.local/occlusion-sam-source'


def _wanted_source(relative):
    path = PurePosixPath(relative)
    return ((path.parts and path.parts[0] == 'sam2' and path.suffix in ['.py', '.yaml', '.yml']) or
            str(path) in ['LICENSE', 'LICENSE_cctorch', 'README.md'])


def _archive_path(name, root=None):
    """Normalize archive names lexically, never using filesystem resolution."""
    if not isinstance(name, str) or '\x00' in name or PurePosixPath(name).is_absolute():
        raise ValueError('Invalid tracking archive path: ' + repr(name))
    parts = []
    for part in name.split('/'):
        if part in ['', '.']:
            continue
        if part == '..':
            if len(parts) <= 1:
                raise ValueError('Tracking archive path escapes its root: ' + name)
            parts.pop()
        else:
            parts.append(part)
    if not parts or root is not None and parts[0] != root:
        raise ValueError('Tracking archive path leaves its root: ' + name)
    return '/'.join(parts)


def extract_source_archive(archive, staged):
    """Materialize pinned source entries, including safe upstream YAML aliases.

    No extract/extractall operation is used. Symbolic/hard-link targets are
    resolved inside the archive's source-member table and copied as ordinary
    files; filesystem links are never created or followed. The caller verifies
    the complete archive SHA256 before invoking this helper.
    """
    staged = Path(staged)
    if staged.is_symlink() or not staged.is_dir() or any(staged.iterdir()):
        raise ValueError('Tracking source staging must be a new empty directory.')
    files = {}
    with tarfile.open(archive, 'r:gz') as bundle:
        entries, root = {}, None
        for member in bundle.getmembers():
            # Ordinary archive member names cannot contain traversal even if
            # the entry is not selected. Only link-target paths may use a safe
            # relative parent traversal that remains inside the archive root.
            if '..' in PurePosixPath(member.name).parts:
                raise ValueError('Invalid tracking archive member path: ' + member.name)
            name = _archive_path(member.name, root)
            if root is None:
                root = name.split('/')[0]
            if name in entries:
                raise ValueError('Duplicate tracking archive entry: ' + name)
            entries[name] = member

        def regular(name, chain=()):
            if name in chain:
                raise ValueError('Cyclic tracking archive alias: ' + ' -> '.join((*chain, name)))
            member = entries.get(name)
            if member is None:
                raise ValueError('Missing tracking archive alias target: ' + name)
            relative = '/'.join(name.split('/')[1:])
            if not _wanted_source(relative):
                raise ValueError('Tracking archive alias targets unsupported source: ' + name)
            if member.isfile():
                if member.size < 0 or member.size > 8 * 1024 ** 2:
                    raise ValueError('Tracking runtime source entry is too large: ' + name)
                return member
            if member.issym() or member.islnk():
                link = member.linkname
                if PurePosixPath(link).is_absolute():
                    raise ValueError('Absolute tracking archive alias: ' + name + ' -> ' + link)
                target = str(PurePosixPath(name).parent / link) if member.issym() else link
                try:
                    target = _archive_path(target, root)
                except ValueError as error:
                    raise ValueError('Unsafe tracking archive alias: ' + name + ' -> ' + link) from error
                return regular(target, (*chain, name))
            raise ValueError('Unexpected tracking runtime source entry type: ' + name)

        for name, member in entries.items():
            relative = '/'.join(name.split('/')[1:])
            if not _wanted_source(relative) or member.isdir():
                continue
            actual = regular(name)
            target = staged / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            # Staging is fresh and this routine creates regular files only.
            # Explicit checks also reject a concurrently introduced path link.
            parents = []
            for parent in target.parents:
                if parent == staged.parent:
                    break
                parents.append(parent)
            if target.is_symlink() or any(p.is_symlink() for p in parents):
                raise ValueError('Linked tracking source staging path: ' + relative)
            with bundle.extractfile(actual) as stream, target.open('xb') as output:
                shutil.copyfileobj(stream, output)
            if target.stat().st_size != actual.size:
                raise ValueError('Incomplete tracking source archive entry: ' + name)
            files[relative] = {'size': target.stat().st_size, 'sha256': digest(target)}
        if 'sam2/build_sam.py' not in files or 'sam2/sam2_video_predictor.py' not in files:
            raise ValueError('The pinned tracking runtime archive is incomplete.')
    return files


def source_ready(verify=False):
    """Fast inventory is marker-based; explicit verification checks source bytes."""
    try:
        cfg = settings()
        marker = json.loads((source_root() / '.recast-source.json').read_text())
        if marker['revision'] != cfg['sam_revision'] or marker['archiveSHA256'] != cfg['sam_archive_sha256']:
            return False
        for name, item in marker['files'].items():
            file = source_root() / name
            if file.is_symlink() or not file.is_file() or file.stat().st_size != item['size']:
                return False
            if verify and digest(file) != item['sha256']:
                return False
        return bool(marker['files'])
    except (OSError, ValueError, KeyError):
        return False


def prepare_source():
    cfg = settings()
    if source_ready(verify=True):
        return
    destination = source_root()
    if destination.exists():
        raise ValueError('The saved tracking runtime source changed. Existing files were preserved.')
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='recast-tracking-', dir=destination.parent) as temporary:
        temporary = Path(temporary)
        archive = temporary / 'source.tar.gz'
        request = urllib.request.Request(cfg['sam_archive_url'], headers={'User-Agent': 'Recast-runtime-setup'})
        with urllib.request.urlopen(request, timeout=60) as response, archive.open('wb') as output:
            shutil.copyfileobj(response, output, length=1024 * 1024)
        if digest(archive) != cfg['sam_archive_sha256']:
            raise ValueError('The tracking runtime archive checksum differs from its pinned source.')
        staged = temporary / 'source'
        staged.mkdir()
        files = extract_source_archive(archive, staged)
        (staged / '.recast-source.json').write_text(json.dumps({
            'revision': cfg['sam_revision'], 'archiveSHA256': cfg['sam_archive_sha256'], 'files': files,
        }, indent=2) + '\n')
        staged.replace(destination)


def prepare(python, profile_sha):
    """Only called by explicit module Download/update, never Generate."""
    cfg = settings()
    print('RECAST_FACIAL_STAGE Preparing hand and partial-face tracking tools', flush=True)
    prepare_source()
    subprocess.run([str(python), '-m', 'pip', 'install', '--no-deps', *cfg['packages']],
                   env={**os.environ, 'PIP_NO_CACHE_DIR': '1'}, check=True)
    # Reuse engine Torch/torchvision. No torch, CUDA toolkit or model download.
    code = ('import sys;sys.path.insert(0,sys.argv[1]);'
            'import torch,torchvision,onnxruntime,hydra,omegaconf,iopath;'
            'from sam2.build_sam import build_sam2_video_predictor;'
            'assert torch.cuda.is_available();'
            'assert "CUDAExecutionProvider" in onnxruntime.get_available_providers()')
    subprocess.run([str(python), '-c', code, str(source_root())], check=True)
    marker = ROOT / 'state/occlusion-runtime-ready.json'
    marker.parent.mkdir(parents=True, exist_ok=True)
    temporary = marker.with_suffix('.tmp.json')
    temporary.write_text(json.dumps({'profileSHA256': profile_sha, 'sourceRevision': cfg['sam_revision'],
                                    'cudaAvailable': True, 'weightDownloads': False}) + '\n')
    temporary.replace(marker)


def ready(profile_sha, verify=False):
    try:
        marker = json.loads((ROOT / 'state/occlusion-runtime-ready.json').read_text())
        return marker['profileSHA256'] == profile_sha and marker['cudaAvailable'] is True and source_ready(verify)
    except (OSError, ValueError, KeyError):
        return False
