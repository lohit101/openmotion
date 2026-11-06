#!/usr/bin/env python3
"""Explicit file browsing/deletion on an already-connected managed GPU. No downloads."""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import urllib.request


def parts(value, empty=False):
    if not isinstance(value, str) or len(value) > 1200 or '\\' in value or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ValueError('Invalid GPU file path.')
    if empty and not value:
        return []
    result = value.split('/')
    if any(p in ('', '.', '..') for p in result):
        raise ValueError('Choose a relative GPU file path.')
    return result


@contextmanager
def directory(root, relative=''):
    """Hold every traversal below a trusted root to directory descriptors, never links."""
    root = Path(root)
    if not root.is_absolute():
        raise ValueError('The GPU storage root must be absolute.')
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in [*root.parts[1:], *parts(relative, empty=True)]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
        yield fd
    finally:
        os.close(fd)


def fingerprint(info):
    values = (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)
    return hashlib.sha256(json.dumps(values, separators=(',', ':')).encode()).hexdigest()


def disk(fd):
    usage = os.fstatvfs(fd)
    total = usage.f_blocks * usage.f_frsize
    free = usage.f_bavail * usage.f_frsize
    return {'totalBytes': total, 'freeBytes': free, 'usedBytes': (usage.f_blocks - usage.f_bfree) * usage.f_frsize}


def list_files(root, relative='', offset=0, limit=300):
    parts(relative, empty=True)
    if not isinstance(offset, int) or not 0 <= offset <= 1_000_000:
        raise ValueError('Invalid file page.')
    with directory(root, relative) as fd:
        entries = []
        with os.scandir(fd) as scan:
            for entry in scan:
                if len(entries) >= 20000:
                    raise ValueError('This folder has more than 20,000 entries. Browse a smaller folder over SSH.')
                try:
                    parts(entry.name)
                    info = entry.stat(follow_symlinks=False)
                except (FileNotFoundError, ValueError):
                    continue
                kind = 'directory' if stat.S_ISDIR(info.st_mode) else 'file' if stat.S_ISREG(info.st_mode) else 'link' if stat.S_ISLNK(info.st_mode) else 'other'
                entries.append({'name': entry.name, 'path': '/'.join(filter(None, [relative, entry.name])), 'kind': kind,
                                'size': info.st_size if kind == 'file' else 0,
                                'modifiedAt': datetime.fromtimestamp(info.st_mtime, timezone.utc).isoformat(),
                                'token': fingerprint(info), 'deletable': kind == 'file' and info.st_nlink == 1 and not entry.name.endswith('.lock')})
        entries.sort(key=lambda e: (e['kind'] != 'directory', -e['size'], e['name']))
        end = min(len(entries), offset + limit)
        return {'absolutePath': str(Path(root) / relative), 'checkedAt': datetime.now(timezone.utc).isoformat(),
                'entries': entries[offset:end], 'total': len(entries), 'nextOffset': end if end < len(entries) else None, **disk(fd)}


def delete_file(root, relative, token):
    path_parts = parts(relative)
    if path_parts[-1].endswith('.lock'):
        raise ValueError('Transfer and runtime locks cannot be deleted from the file browser.')
    with directory(root, '/'.join(path_parts[:-1])) as fd:
        name = path_parts[-1]
        base = name.removesuffix('.part').removesuffix('.verified.json')
        lock = os.open(base + '.lock', os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600, dir_fd=fd)
        try:
            info = os.fstat(lock)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                raise ValueError('Refusing a linked or non-regular lock.')
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise ValueError('This file is in use by a transfer. Finish or cancel it first.')
            try:
                info = os.stat(name, dir_fd=fd, follow_symlinks=False)
            except FileNotFoundError:
                return {'removed': False, 'freedBytes': 0, 'freeBytes': disk(fd)['freeBytes']}
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                raise ValueError('Refusing to delete a linked or non-regular file.')
            if fingerprint(info) != token:
                raise ValueError('This file changed since it was listed. Refresh the folder and select it again.')
            os.unlink(name, dir_fd=fd)
            return {'removed': True, 'freedBytes': info.st_size, 'freeBytes': disk(fd)['freeBytes']}
        finally:
            os.close(lock)


def assert_remote_idle(workspace):
    # No inference, runtime preparation or transfers are started by this probe.
    with urllib.request.urlopen('http://127.0.0.1:8188/queue', timeout=5) as response:
        queue = json.load(response)
    if not isinstance(queue, dict) or not all(isinstance(queue.get(key), list) for key in ('queue_running', 'queue_pending')):
        raise ValueError('GPU activity could not be verified. No file was deleted.')
    if queue['queue_running'] or queue['queue_pending']:
        raise ValueError('Finish the GPU render queue before deleting files.')
    names = (b'/model_download_worker.py', b'/model_setup_worker.py', b'/facial_worker.py', b'/upscale_worker.py',
             b'/clarity_worker.py', b'/gpu_identity_worker.py', b'/video_face_worker.py', b'/video_identity.py', b'/managed_openjutsu_tools.py')
    for proc in Path('/proc').glob('[0-9]*'):
        if proc.name == str(os.getpid()):
            continue
        try:
            args = (proc / 'cmdline').read_bytes().split(b'\0')
        except FileNotFoundError:
            continue
        if any(arg.endswith(names) for arg in args):
            raise ValueError('A GPU worker is still running. Finish its work before deleting files.')


def active_comfy_root(workspace):
    """Find the already-running loopback engine; never starts or imports it."""
    from pathlib import Path
    workspace = Path(workspace).parent.resolve()
    for proc in Path('/proc').glob('[0-9]*'):
        try:
            args = (proc / 'cmdline').read_bytes().split(b'\0')
            if not any(arg == b'main.py' or arg.endswith(b'/main.py') for arg in args): continue
            if b'--port' in args and args[args.index(b'--port') + 1] != b'8188': continue
            root = (proc / 'cwd').resolve(strict=True)
            if workspace not in root.parents or not (root / 'main.py').is_file() or not (root / 'models').is_dir(): continue
            return root
        except (OSError, ValueError, IndexError): continue
    return None


def roots(workspace):
    workspace = Path(workspace)
    result = {'models': workspace / 'models', 'input': workspace / 'data/input', 'output': workspace / 'data/output',
              'temp': workspace / 'data/temp', 'workspace': workspace}
    # Installation paths are saved by bootstrap, never supplied by the browser.
    try:
        with directory(workspace, 'state') as fd:
            record = os.open('install.json', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=fd)
            with os.fdopen(record) as stream:
                comfy = Path(json.load(stream)['comfy_root'])
            if not comfy.is_absolute() or '..' in comfy.parts or comfy == Path('/'):
                raise ValueError('Invalid saved ComfyUI installation path.')
            result['comfy'] = comfy
    except FileNotFoundError:
        pass
    active = active_comfy_root(workspace)
    if active is not None: result['comfy'] = active
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', required=True)
    parser.add_argument('--request', required=True)
    parser.add_argument('--delete', action='store_true')
    args = parser.parse_args()
    request = json.loads(args.request)
    locations = roots(args.workspace)
    if request['root'] not in locations:
        raise ValueError('This GPU storage location is not installed.')
    location = locations[request['root']]
    if args.delete:
        assert_remote_idle(args.workspace)
        result = delete_file(location, request['path'], request['token'])
    else:
        result = list_files(location, request['path'], request.get('offset', 0))
    print('RECAST_GPU_FILES ' + json.dumps({**request, **result}), flush=True)


if __name__ == '__main__':
    main()
