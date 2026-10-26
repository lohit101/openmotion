#!/usr/bin/env python3
"""Manage only this installation's private ComfyUI process."""

import argparse
import hashlib
import json
import os
import signal
import shlex
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / "state"
PIDFILE = STATE / "server.json"
LOG = STATE / "comfyui.log"
SUPERVISOR_CONFIG = Path("/etc/supervisor/conf.d/character-swap.conf")
PROC = Path('/proc')


def managed():
    return Path("/etc/vast-agents-guide.md").exists() and os.geteuid() == 0


def register_service():
    """Use the instance's service manager while keeping access private over SSH."""
    wrapper = Path("/opt/supervisor-scripts/character-swap.sh")
    wrapper.write_text("#!/bin/bash\nset -o pipefail\n"
                       "utils=/opt/supervisor-scripts/utils\n"
                       '. "${utils}/logging.sh"\n. "${utils}/environment.sh"\n'
                       + "pty " + shlex.join([sys.executable, str(Path(__file__).resolve()), "run"])
                       + " 2>&1 | tee -a " + shlex.quote(str(LOG)) + "\n")
    wrapper.chmod(0o755)
    SUPERVISOR_CONFIG.write_text(
        '[program:character-swap]\nenvironment=PROC_NAME="%(program_name)s"\n'
        'command=/opt/supervisor-scripts/character-swap.sh\n'
        'autostart=true\nautorestart=unexpected\nstartsecs=5\n'
        'stopasgroup=true\nkillasgroup=true\nstopsignal=INT\nstopwaitsecs=40\n'
        'stdout_logfile=/dev/stdout\nredirect_stderr=true\nstdout_logfile_maxbytes=0\n')
    subprocess.run(["supervisorctl", "reread"], check=True)
    subprocess.run(["supervisorctl", "update", "character-swap"], check=True)


def configuration():
    if not (STATE / "install.json").exists():
        raise SystemExit("Setup is incomplete. Run scripts/bootstrap.sh on the GPU instance first.")
    install = json.loads((STATE / "install.json").read_text())
    return install, json.loads((ROOT / "config/server.json").read_text())


def running():
    install, config = configuration()
    main = str(Path(install['comfy_root']) / 'main.py')
    def owned(pid):
        try:
            os.kill(pid, 0)
            command = PROC / str(pid) / 'cmdline'
            if not PROC.exists():
                return True
            args = command.read_bytes().decode(errors='replace').split('\0')
            def option(name, value):
                return any(args[i:i+2] == [name, str(value)] for i in range(len(args)-1))
            return main in args and option('--port', config['port']) and option('--input-directory', ROOT / 'data/input')
        except (OSError, ValueError):
            return False
    try:
        saved = json.loads(PIDFILE.read_text())
        if saved.get('main') == main and owned(saved['pid']):
            return saved
    except (OSError, ValueError, KeyError):
        pass
    # A stale/missing PID file must not turn our surviving ComfyUI process
    # into an unrelated-port error. Match the exact install, port and inputs.
    if PROC.exists():
        candidates = [int(p.name) for p in PROC.iterdir() if p.name.isdigit() and owned(int(p.name))]
        if len(candidates) == 1:
            saved = {'pid': candidates[0], 'main': main, 'started': time.time(), 'recovered': True}
            STATE.mkdir(exist_ok=True); PIDFILE.write_text(json.dumps(saved)); return saved
    return None


def signal_owned(saved, value):
    """Stop isolated child groups without touching a shared shell's group."""
    pid = saved['pid']
    try:
        if os.getpgid(pid) == pid:
            os.killpg(pid, value)
        else:
            os.kill(pid, value)
    except ProcessLookupError:
        pass


def ready(port):
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d/system_stats" % port, timeout=2) as response:
            return response.status == 200
    except OSError:
        return False


def launch_arguments():
    install, config = configuration()
    main = str(Path(install["comfy_root"]) / "main.py")
    arguments = [sys.executable, main, "--listen", config["host"], "--port", str(config["port"]),
                 "--reserve-vram", str(config["reserve_vram_gb"]), "--cache-ram"]
    arguments.extend(str(x) for x in config["cache_ram_gb"])
    arguments.extend(["--disable-partner-nodes", "--use-pytorch-cross-attention", "--disable-xformers",
                      "--max-upload-size", str(config["max_upload_mb"]), "--extra-model-paths-config", str(STATE / "model-paths.yaml"),
                      "--input-directory", str(ROOT / "data/input"), "--output-directory", str(ROOT / "data/output"),
                      "--temp-directory", str(ROOT / "data/temp"), "--user-directory", str(ROOT / "data/user")])
    return install, config, main, arguments


def runtime_key(install):
    """Identify the installed code and launch settings, excluding model files."""
    comfy = Path(install['comfy_root'])
    digest = hashlib.sha256()
    for directory in (comfy, comfy / 'custom_nodes/ComfyUI-VideoHelperSuite', comfy / 'custom_nodes/ComfyUI-Viggle-Animate-H3'):
        result = subprocess.run(['git', '-C', str(directory), 'rev-parse', 'HEAD'], capture_output=True, text=True)
        digest.update(str(directory).encode())
        digest.update(result.stdout.strip().encode() if result.returncode == 0 else b'missing-revision')
    for file in sorted((comfy / 'custom_nodes/character_swap_helpers').glob('*.py')):
        digest.update(file.name.encode()); digest.update(file.read_bytes())
    for file in (ROOT / 'config/server.json', ROOT / 'config/runtime.lock.json', Path(__file__), STATE / 'model-paths.yaml'):
        digest.update(file.name.encode()); digest.update(file.read_bytes() if file.exists() else b'missing-file')
    return digest.hexdigest()


def verify_runtime_source(install):
    """Reject an old cached engine before declaring a new recipe ready."""
    lock = json.loads((ROOT / 'config/runtime.lock.json').read_text())
    comfy = Path(install['comfy_root'])
    for directory, field in ((comfy, 'comfyui_commit'), (comfy / 'custom_nodes/ComfyUI-VideoHelperSuite', 'video_helper_commit'), (comfy / 'custom_nodes/ComfyUI-Viggle-Animate-H3', 'viggle_commit')):
        result = subprocess.run(['git', '-C', str(directory), 'rev-parse', 'HEAD'], capture_output=True, text=True)
        if result.returncode or result.stdout.strip() != lock[field]:
            raise RuntimeError('Cached runtime revision differs from the pinned setup: ' + field)
    source = ROOT / 'custom_nodes/character_swap_helpers'
    target = comfy / 'custom_nodes/character_swap_helpers'
    expected = {f.name: f.read_bytes() for f in source.glob('*.py')}
    installed = {f.name: f.read_bytes() for f in target.glob('*.py')}
    if not expected or expected != installed:
        raise RuntimeError('Cached helper code needs the current pinned setup before rendering.')
    saved = running()
    if not saved or saved.get('runtime_key') != runtime_key(install):
        raise RuntimeError('ComfyUI has not loaded the current runtime. Run pinned setup; it reloads only after the queue is idle.')


def sync_runtime():
    """Reload changed owned code, waiting for all current work to finish."""
    install, config = configuration()
    saved = running()
    if saved and saved.get('runtime_key') != runtime_key(install):
        attempt = 0
        while running():
            with urllib.request.urlopen('http://127.0.0.1:%d/queue' % config['port'], timeout=30) as response:
                queue = json.load(response)
            if not isinstance(queue.get('queue_running'), list) or not isinstance(queue.get('queue_pending'), list):
                raise RuntimeError('Cannot verify the existing ComfyUI queue. No server restart was requested.')
            if not queue['queue_running'] and not queue['queue_pending']:
                stop()
                break
            if attempt % 15 == 0:
                print('RECAST_WARNING Waiting for the existing ComfyUI queue to finish before loading updated code. Its render has not been interrupted.', flush=True)
            attempt += 1
            time.sleep(2)
    return start()


def run_foreground():
    install, _, main, arguments = launch_arguments()
    STATE.mkdir(exist_ok=True)
    PIDFILE.write_text(json.dumps({"pid": os.getpid(), "main": main, "started": time.time(), "runtime_key": runtime_key(install)}))
    os.chdir(install["comfy_root"])
    os.environ["PYTHONUNBUFFERED"] = "1"
    os.environ["PYTHONFAULTHANDLER"] = "1"
    os.execv(arguments[0], arguments)


def wait_ready(config, process=None, service=False):
    attempt = 0
    while True:
        if ready(config['port']):
            print('Ready on 127.0.0.1:%d. Connect through your SSH tunnel.' % config['port'])
            return
        if process is not None and process.poll() is not None:
            raise SystemExit('ComfyUI exited. Last log lines:\n' + '\n'.join(LOG.read_text(errors='replace').splitlines()[-35:]))
        if service:
            status = subprocess.run(['supervisorctl', 'status', 'character-swap'], capture_output=True, text=True)
            if any(value in status.stdout for value in ('FATAL', 'EXITED', 'BACKOFF', 'STOPPED')):
                raise SystemExit('The managed ComfyUI service failed: ' + status.stdout.strip())
        elif process is None and not running():
            raise SystemExit('The existing ComfyUI process exited before becoming ready.')
        attempt += 1
        if attempt % 120 == 0:
            print('RECAST_WARNING ComfyUI startup is taking longer than usual. The process is still running; continuing to wait.', flush=True)
        time.sleep(1)


def start():
    install, config, main, arguments = launch_arguments()
    if running():
        print("ComfyUI is already running on private port %d." % config["port"])
        return wait_ready(config)
    with socket.socket() as probe:
        if probe.connect_ex(("127.0.0.1", config["port"])) == 0:
            raise SystemExit("Port %d belongs to another process. Change config/server.json and your local connection settings." % config["port"])
    STATE.mkdir(exist_ok=True)
    if managed():
        register_service()
        status = subprocess.run(["supervisorctl", "status", "character-swap"], capture_output=True, text=True)
        if not any(state in status.stdout for state in ("RUNNING", "STARTING")):
            subprocess.run(["supervisorctl", "start", "character-swap"], check=True)
        return wait_ready(config, service=True)
    with LOG.open("ab") as log:
        process = subprocess.Popen(arguments, cwd=install["comfy_root"], env={**os.environ, 'PYTHONUNBUFFERED': '1', 'PYTHONFAULTHANDLER': '1'}, stdout=log, stderr=subprocess.STDOUT,
                                   stdin=subprocess.DEVNULL, start_new_session=True)
    PIDFILE.write_text(json.dumps({"pid": process.pid, "main": main, "started": time.time(), "runtime_key": runtime_key(install)}))
    print("Starting ComfyUI; log: " + str(LOG), flush=True)
    return wait_ready(config, process=process)


def stop():
    if managed() and SUPERVISOR_CONFIG.exists():
        result = subprocess.run(["supervisorctl", "stop", "character-swap"], capture_output=True, text=True)
        if result.returncode and "not running" not in result.stdout:
            raise SystemExit(result.stdout + result.stderr)
        PIDFILE.unlink(missing_ok=True)
        print("Managed ComfyUI stopped. The Vast instance continues billing.")
        return
    saved = running()
    if not saved:
        print("This ComfyUI installation is stopped.")
        return
    signal_owned(saved, signal.SIGINT)
    for _ in range(30):
        if not running():
            PIDFILE.unlink(missing_ok=True)
            print("ComfyUI stopped. The Vast instance still bills until you stop it in Vast.")
            return
        time.sleep(1)
    saved = running()
    if not saved:
        PIDFILE.unlink(missing_ok=True); return
    signal_owned(saved, signal.SIGTERM)
    for _ in range(10):
        if not running():
            PIDFILE.unlink(missing_ok=True)
            print("ComfyUI stopped after SIGTERM. The rented GPU continues billing.")
            return
        time.sleep(1)
    raise SystemExit("The owned ComfyUI process did not stop. Inspect logs before restarting it.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["start", "stop", "restart", "status", "logs", "run", "sync"])
    args = parser.parse_args()
    if args.action == "run":
        run_foreground()
    if args.action == 'sync':
        return sync_runtime()
    if args.action in ("stop", "restart"):
        stop()
    if args.action in ("start", "restart"):
        start()
    elif args.action == "status":
        _, config = configuration()
        print(json.dumps({"running": bool(running()), "ready": ready(config["port"]), "port": config["port"], "log": str(LOG)}, indent=2))
    elif args.action == "logs":
        subprocess.run(["tail", "-n", "100", "-f", str(LOG)], check=True)


if __name__ == "__main__":
    main()
