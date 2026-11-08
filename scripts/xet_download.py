"""Hugging Face Xet ordered streams, keeping the normal contiguous .part file.

No weight cache or second full-size staging copy. Non-Xet Hub objects and custom
URLs use the existing HTTP path. Imports happen after the worker's Xet tuning.
"""
import errno
import fcntl
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import time


RUNTIME = Path(__file__).resolve().parents[1]
LOCK = RUNTIME / 'config/model-download-runtime.lock.json'


class XetDownloadError(OSError):
    pass


class XetAccessError(RuntimeError):
    pass


def hf_source(item):
    """Use only manifest-bound model repos, never reinterpret an explicit URL."""
    return (not item.get('url') and isinstance(item.get('repo'), str)
            and bool(re.fullmatch(r'[\w.-]+/[\w.-]+', item['repo']))
            and all(p not in ('.', '..') for p in item['repo'].split('/'))
            and isinstance(item.get('revision'), str)
            and bool(re.fullmatch(r'[a-f0-9]{40}', item['revision']))
            and isinstance(item.get('filename'), str)
            and not PurePosixPath(item['filename']).is_absolute()
            and all(p not in ('', '.', '..') for p in item['filename'].split('/')))


def host_memory():
    try:
        total = os.sysconf('SC_PHYS_PAGES') * os.sysconf('SC_PAGE_SIZE')
    except (ValueError, OSError, AttributeError):
        total = 2 * 1024 ** 3
    for name in ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes']:
        try:
            limit = int(Path(name).read_text().strip())
            if limit > 0:
                total = min(total, limit)
        except (OSError, ValueError):
            pass
    return total


def tune_xet():
    # Xet reads these at import/runtime initialization. Four managed file workers
    # share the host, so bound per-file buffers even on very large-RAM rentals.
    memory = host_memory()
    try:
        cpus = len(os.sched_getaffinity(0))
    except (AttributeError, OSError):
        cpus = os.cpu_count() or 2
    values = {
        'HF_XET_HIGH_PERFORMANCE': '1',
        'HF_XET_CHUNK_CACHE_SIZE_BYTES': '0',
        'HF_XET_NUM_CONCURRENT_RANGE_GETS': str(min(32, max(4, cpus * 2), max(4, memory // (128 * 1024 ** 2)))),
        'HF_XET_RECONSTRUCTION_DOWNLOAD_BUFFER_PERFILE_SIZE': str(min(256 * 1024 ** 2, max(16 * 1024 ** 2, memory // 64))),
    }
    for name, value in values.items():
        os.environ.setdefault(name, value)
    return {name: os.environ[name] for name in values}


def client_python(root):
    """Explicit download-only provisioning; do not touch ComfyUI site-packages."""
    spec = json.loads(LOCK.read_text())
    client = RUNTIME / 'xet-client'
    if client.is_symlink():
        raise ValueError('Refusing a linked Xet client environment.')
    python = client / 'bin/python'
    marker = client / 'recast-ready.json'
    probe = ('import importlib.metadata as m; from hf_xet import XetSession; '
             'from huggingface_hub import get_hf_file_metadata; '
             'assert callable(XetSession.new_download_stream_group); '
             'assert m.version("huggingface-hub")=="2.4.0"; '
             'assert m.version("hf-xet")=="1.8.0"')
    with (RUNTIME / 'xet-client.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if python.is_file() and marker.is_file() and json.loads(marker.read_text()) == spec:
            subprocess.run([str(python), '-c', probe], check=True, timeout=30)
            return python
        bootstrap = Path(root) / '.venv/bin/python'
        bootstrap = str(bootstrap) if bootstrap.is_file() else sys.executable
        if not python.is_file():
            subprocess.run([bootstrap, '-m', 'venv', str(client)], check=True, timeout=60)
        subprocess.run([str(python), '-m', 'pip', 'install', '--disable-pip-version-check',
                        '--no-cache-dir', '--only-binary=:all:', '--timeout', '30', '--retries', '2',
                        *spec['requirements']], check=True)
        subprocess.run([str(python), '-c', probe], check=True, timeout=30)
        temporary = marker.with_suffix('.tmp')
        temporary.write_text(json.dumps(spec)); temporary.replace(marker)
    return python


def stream_download(item, part, report, *, required=False):
    """Return False only for an unavailable client or a genuinely non-Xet file.

    A failed Xet transfer is retried by the existing caller, never silently
    restarted as a full HTTP download. Written bytes are a contiguous prefix.
    """
    tune_xet()
    try:
        from hf_xet import XetFileInfo, XetSession
        from huggingface_hub import get_hf_file_metadata, hf_hub_url
        from huggingface_hub.utils import build_hf_headers
    except ImportError as error:
        if required:
            raise XetAccessError('The pinned Xet client is unavailable. Retry Download to prepare it.') from error
        return False
    size = item['size']
    offset = part.stat().st_size if part.exists() else 0
    if offset == size:
        return True
    callback_error = None

    def emit(*args):
        nonlocal callback_error
        try:
            report(*args)
        except Exception as error:
            callback_error = error
            raise

    try:
        headers = build_hf_headers(token=os.environ.get('HF_TOKEN') or False, user_agent='recast-xet/1')
        metadata = get_hf_file_metadata(hf_hub_url(item['repo'], item['filename'], revision=item['revision']),
                                        headers=headers, timeout=30)
        if metadata.size != size or metadata.commit_hash != item['revision']:
            raise XetAccessError('The Hub file metadata does not match the pinned model.')
        if metadata.xet_file_data is None:
            return False
        if metadata.etag != item['sha256']:
            raise XetAccessError('The Hub file checksum does not match the pinned model.')
        from urllib.parse import urlsplit
        route = urlsplit(metadata.xet_file_data.refresh_route)
        if route.scheme != 'https' or route.hostname != 'huggingface.co' or route.username or route.password:
            raise XetAccessError('Refusing an unexpected Xet credential-refresh host.')
        session = XetSession()
        # A source token goes only to the Hub. CAS receives its scoped Xet token;
        # the client resolves/refreshes it using the same official Hub metadata.
        with session.new_download_stream_group(
                token_refresh_url=metadata.xet_file_data.refresh_route,
                token_refresh_headers=headers,
                custom_headers={k: v for k, v in headers.items() if k.lower() != 'authorization'}) as group:
            started = last_report = time.monotonic()
            count = offset
            emit(item, count, 'downloading')
            with part.open('ab') as output:
                for chunk in group.download_stream(XetFileInfo(metadata.xet_file_data.file_hash, size), start=offset, end=size):
                    if len(chunk) > size - count:
                        raise XetAccessError('Xet returned more bytes than the pinned file size.')
                    output.write(chunk)
                    count += len(chunk)
                    now = time.monotonic()
                    if now - last_report >= 1 or count == size:
                        output.flush()
                        emit(item, count, 'downloading', (count - offset) / max(.001, now - started))
                        last_report = now
            if count != size:
                raise XetDownloadError('Incomplete Xet stream; its contiguous partial file is retained.')
        return True
    except XetAccessError:
        raise
    except Exception as error:
        if error is callback_error:
            raise
        if isinstance(error, OSError) and error.errno in (errno.ENOSPC, errno.EDQUOT):
            raise XetAccessError('The model disk is full. Free space and retry Download; saved bytes are retained.') from None
        status = getattr(getattr(error, 'response', None), 'status_code', None)
        if status in (401, 403, 404):
            raise XetAccessError('Model access failed (HTTP %s). Check the pinned source and access rights.' % status) from None
        # Signed URLs or tokens in native/client exceptions must not reach logs.
        raise XetDownloadError('Xet transfer interrupted (%s); saved bytes are retained.' % type(error).__name__) from None
