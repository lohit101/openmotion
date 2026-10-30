"""Release idle ComfyUI caches before a separate CUDA facial process starts.

This is resource admission, not a facial recipe: it changes no model, input,
sampling setting or paid result and never starts/stops compute.
"""
import fcntl
import json
from pathlib import Path
import subprocess
import sys
import time
import urllib.request
import uuid

MINIMUM_FREE_BYTES = 10 * 1024 ** 3


def require_idle(port):
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/queue', timeout=5) as response:
        queue = json.load(response)
    if not isinstance(queue, dict) or any(not isinstance(queue.get(key), list) for key in ['queue_running', 'queue_pending']):
        raise ValueError('GPU queue status is unknown. Existing work was left alone; reconnect and check it.')
    if queue['queue_running'] or queue['queue_pending']:
        raise ValueError('ComfyUI has queued or running work. Finish it before starting the facial pass; saved video is kept.')


def gpu_memory():
    output = subprocess.check_output(['nvidia-smi', '--query-gpu=memory.total,memory.free',
                                      '--format=csv,noheader,nounits'], text=True, timeout=5)
    rows = [line.strip() for line in output.splitlines() if line.strip()]
    if len(rows) != 1:
        raise ValueError('Could not verify memory on one assigned GPU. No facial process was launched.')
    try:
        total, free = [int(value.strip()) * 1024 ** 2 for value in rows[0].split(',')]
    except (ValueError, TypeError) as error:
        raise ValueError('GPU memory status is unreadable. No facial process was launched.') from error
    if not 0 <= free <= total:
        raise ValueError('GPU memory status is invalid. No facial process was launched.')
    return {'totalBytes': total, 'freeBytes': free}


def release_idle_cache(port):
    request = urllib.request.Request(f'http://127.0.0.1:{port}/free',
                                    data=b'{"unload_models":true,"free_memory":true}',
                                    headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=10) as response:
        if response.status != 200:
            raise ValueError('ComfyUI did not confirm cache release. Saved media and disk models were kept.')


def ensure_memory(port, minimum=MINIMUM_FREE_BYTES, timeout=30, cancelled=lambda: False):
    if cancelled():
        raise ValueError('Facial memory check cancelled before launch. Saved video was kept.')
    require_idle(port)
    before = gpu_memory()
    require_idle(port)  # Work may have arrived during the driver probe.
    if before['freeBytes'] >= minimum:
        return {'releasedCache': False, 'minimumFreeBytes': minimum, 'before': before, 'after': before}
    if cancelled():
        raise ValueError('Facial memory check cancelled before cache release. Saved video was kept.')
    release_idle_cache(port)
    deadline = time.monotonic() + timeout
    after = before
    while time.monotonic() < deadline:
        if cancelled():
            raise ValueError('Facial memory check cancelled before launch. Saved video was kept.')
        require_idle(port)
        after = gpu_memory()
        if after['freeBytes'] >= minimum:
            require_idle(port)
            return {'releasedCache': True, 'minimumFreeBytes': minimum, 'before': before, 'after': after}
        time.sleep(.5)
    raise ValueError(f'Not enough free GPU memory for facial finishing: {after["freeBytes"] / 1024**3:.1f} GB free; '
                     f'{minimum / 1024**3:.0f} GB working reserve required. ComfyUI cache release was requested. '
                     'No facial process was launched; rendered video and disk models were kept. '
                     'Finish other GPU work, then Check & resume the saved run.')


def main():
    root, job, phase = Path(sys.argv[1]), str(uuid.UUID(sys.argv[2])), sys.argv[3]
    if phase not in ['run', 'preflight']:
        raise ValueError('Unsupported facial memory-check phase.')
    sys.path.insert(0, str(root / 'scripts'))
    from facial_worker import running
    folder = root / 'jobs' / job
    if running(folder):
        if phase != 'run':
            raise ValueError('The existing facial worker is still running. Resume that worker instead of checking a new reference.')
        print(json.dumps({'reusingRunningWorker': True, 'jobId': job}), flush=True)
        return
    # Never unload anything while another facial worker owns the GPU.
    with (root / 'state/processing.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise ValueError('Another facial worker is active. Wait for it; no cache was released or process launched.') from error
        port = json.loads((root / 'config/server.json').read_text())['port']
        if not isinstance(port, int) or not 1 <= port <= 65535:
            raise ValueError('Invalid managed ComfyUI port.')
        result = {'jobId': job, 'phase': phase, **ensure_memory(port)}
        directory = folder / 'memory-checks'
        directory.mkdir(exist_ok=True)
        file = directory / (str(time.time_ns()) + '.json')
        file.write_text(json.dumps(result) + '\n')
        print(json.dumps(result), flush=True)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
