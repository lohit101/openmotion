#!/usr/bin/env python3
"""Start the engine without weights; the full Natural bundle remains opt-in."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

from model_manifest import required_setup_manifest

ROOT = Path(__file__).resolve().parents[1]


def terminate_children(children):
    for child in children:
        if child.poll() is None:
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
    for child in children:
        try:
            child.wait(timeout=8)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            child.wait()


def run_parallel(tasks, env=None):
    """Fail on an actual task error and stop sibling processes, keeping partials."""
    children = []
    previous = {}

    def interrupted(signum, _frame):
        raise KeyboardInterrupt('Setup interrupted by signal %d' % signum)

    try:
        for signum in (signal.SIGINT, signal.SIGTERM):
            previous[signum] = signal.signal(signum, interrupted)
        for label, command in tasks:
            children.append((label, subprocess.Popen(command, env=env, start_new_session=True)))
        while True:
            pending = False
            for label, child in children:
                code = child.poll()
                if code is None:
                    pending = True
                elif code:
                    raise RuntimeError('%s failed with exit code %d. Downloaded files and partials are retained.' % (label, code))
            if not pending:
                return
            time.sleep(0.25)
    finally:
        terminate_children([child for _label, child in children])
        for signum, handler in previous.items():
            signal.signal(signum, handler)


def main():
    state = ROOT / 'state'
    state.mkdir(parents=True, exist_ok=True)
    with_models = os.environ.get('RECAST_SETUP_MODE', 'runtime') == 'required'
    manifest = required_setup_manifest()
    plan = state / 'required-models.json'
    plan.write_text(json.dumps(manifest, indent=2) + '\n')
    reserve = '5' if (state / 'packages-ready.json').exists() else '17'
    env = dict(os.environ, RECAST_SKIP_MODEL_DOWNLOADS='1', PYTHONUNBUFFERED='1')
    python = ROOT / '.venv/bin/python'
    # A healthy cached engine needs no further apt/pip pass. This probe never
    # renders or downloads a model.
    healthy = False
    if python.is_file() and (state / 'packages-ready.json').exists():
        try:
            subprocess.run(['bash', str(ROOT / 'scripts/server.sh'), 'start'], check=True, timeout=120)
            healthy = subprocess.run([str(python), str(ROOT / 'scripts/doctor.py'), '--runtime-only'], timeout=120).returncode == 0
        except (OSError, subprocess.SubprocessError):
            pass
    print('RECAST_STAGE %s. %s' % ('Reusing the installed runtime' if healthy else 'Installing the blank ComfyUI engine',
          'Downloading the explicitly requested Natural bundle.' if with_models else 'No model weights will download during startup.'), flush=True)
    tasks = [('Required model download', [sys.executable, '-u', str(ROOT / 'scripts/download_models.py'),
              '--manifest', str(plan), '--model-dir', str(ROOT / 'models'), '--reserve-gb', reserve])] if with_models else []
    if not healthy:
        tasks.append(('ComfyUI runtime installation', ['bash', str(ROOT / 'scripts/bootstrap.sh')]))
    run_parallel(tasks, env)
    # A fresh bootstrap checks CUDA and live schemas before exiting; a reused
    # engine was checked above. Avoid importing/initializing CUDA a second time.
    # An opt-in full recipe still needs its post-transfer model integrity check.
    if with_models:
        print('RECAST_STAGE Verifying the requested model bundle', flush=True)
        subprocess.run([str(python), str(ROOT / 'scripts/doctor.py'), '--manifest', str(plan)], check=True)
    print('RECAST_STAGE Engine ready. Download only the files for your selected settings in Studio.', flush=True)


if __name__ == '__main__':
    try:
        main()
    except (OSError, RuntimeError, subprocess.SubprocessError, KeyboardInterrupt) as error:
        raise SystemExit(str(error)) from error
