"""Prepare the original Clarity runtime without changing its inference fingerprint."""
import argparse
import fcntl
from pathlib import Path
import subprocess
import sys

import upscale_worker as native
from package_install import SetupCommands, SetupInstaller


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('action', choices=['prepare', 'worker']); args = parser.parse_args()
    (native.ROOT / 'state').mkdir(parents=True, exist_ok=True)
    if args.action == 'prepare':
        # Two explicit requests may arrive together. Protect the detached launch
        # as well as the original worker's independent installation lock.
        with (native.ROOT / 'state/setup-launch.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            current = native.inspect()
            if not current['ready'] and not current['preparing']:
                native.atomic(native.ROOT / 'state/setup.json', {'complete': False})
                with (native.ROOT / 'state/setup.log').open('ab') as log:
                    child = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), 'worker'], stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
                native.atomic(native.ROOT / 'state/setup-pid.json', {'pid': child.pid})
        print('RECAST_UPSCALE ' + native.json.dumps(native.inspect()), flush=True)
        return
    installer = SetupInstaller(native.ROOT)
    native.subprocess = SetupCommands(installer)
    try:
        native.prepare()  # Original pins, disk checks, imports and CUDA kernel self-test.
        for python in installer.completed: installer.seal(python)
        native.atomic(native.ROOT / 'state/setup.json', {'complete': True})
    except Exception as error:
        native.atomic(native.ROOT / 'state/setup.json', {'error': str(error)}); raise


if __name__ == '__main__': main()
