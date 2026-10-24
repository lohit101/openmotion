#!/usr/bin/env python3
"""Deploy and observe a Recast rental. No Vast API credential is sent to the GPU."""
import argparse
import json
import os
import shutil
import socket
from pathlib import Path
import shlex
import subprocess
import time
from types import SimpleNamespace

import vast


def check_local(identity):
    for tool in ('ssh', 'ssh-keygen', 'python3', 'ffmpeg', 'ffprobe'):
        if not shutil.which(tool):
            raise ValueError('Install %s on this Mac before renting a GPU.' % tool)
    if not identity.is_file() or not Path(str(identity) + '.pub').is_file():
        raise ValueError('The local SSH key pair is incomplete. No rental should be started.')
    expected = Path(str(identity) + '.pub').read_text().split()[:2]
    public = subprocess.run(['ssh-keygen', '-y', '-P', '', '-f', str(identity)], capture_output=True, text=True, timeout=10)
    usable = public.returncode == 0 and public.stdout.split()[:2] == expected
    if not usable and shutil.which('ssh-add'):
        agent = subprocess.run(['ssh-add', '-L'], capture_output=True, text=True, timeout=5)
        usable = agent.returncode == 0 and any(line.split()[:2] == expected for line in agent.stdout.splitlines())
    if not usable:
        raise ValueError('The SSH private key cannot authenticate with its public key. Unlock it in ssh-agent before renting.')
    for name in ('README.md', 'config', 'scripts', 'custom_nodes', 'workflows', 'tests', 'validation'):
        if not (vast.ROOT / name).exists():
            raise ValueError('Deployment package is incomplete: ' + name)
    for name in ('models.lock.json', 'optional-models.lock.json', 'runtime.lock.json', 'server.json'):
        json.loads((vast.ROOT / 'config' / name).read_text())
    # CPU-only dependency/model checks happen before any paid rental request.
    subprocess.run([shutil.which('python3'), str(vast.ROOT / 'scripts/setup_local_geometry.py'), '--check'], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
    with socket.socket() as probe:
        occupied = probe.connect_ex(('127.0.0.1', 8188)) == 0
    if occupied:
        saved = json.loads(vast.CONFIG.read_text()) if vast.CONFIG.exists() else None
        if not saved or saved.get('local_port') != 8188 or not vast.master_running(saved):
            raise ValueError('Local port 8188 belongs to another application. Free it before renting a GPU.')
    return {'ok': True, 'ssh_key_ready': True, 'deployment_files_ready': True, 'local_port_ready': True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host')
    parser.add_argument('--port', type=int)
    parser.add_argument('--identity', required=True, type=Path)
    parser.add_argument('--instance-id', type=int)
    parser.add_argument('--check-local', action='store_true')
    args = parser.parse_args()
    os.environ['RECAST_SSH_BATCH'] = '1'
    result = check_local(args.identity)
    if args.check_local:
        print(json.dumps(result)); return
    if not args.host or not args.port or not args.instance_id or args.instance_id <= 0:
        raise ValueError('A host, port and valid instance ID are required for managed deployment.')
    # Reuse the strict host/port parser and private tunnel configuration.
    config = vast.parse_ssh('ssh -p %d root@%s' % (args.port, args.host))
    config.update(identity=str(args.identity.resolve()), local_port=8188,
                  remote_port=json.loads((vast.ROOT / 'config/server.json').read_text())['port'],
                  remote_root='/workspace/character-swap', instance_id=args.instance_id,
                  host_key_alias='recast-instance-%d' % args.instance_id)
    print('RECAST_STAGE Waiting for the new instance SSH service', flush=True)
    attempt = 0
    while True:
        try:
            ready = subprocess.run(vast.ssh_arguments(config) + ['-T', vast.destination(config), 'true'],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=18)
            if ready.returncode == 0: break
            detail = ready.stderr.decode(errors='replace')
            if attempt >= 2 and any(text in detail for text in ('Permission denied', 'REMOTE HOST IDENTIFICATION HAS CHANGED')):
                raise SystemExit('SSH authentication or host verification failed. Check the attached public key and host identity.')
        except subprocess.TimeoutExpired:
            pass
        attempt += 1
        if attempt % 10 == 0:
            print('RECAST_WARNING SSH is taking longer than usual. Waiting for this same instance; it will not be stopped for elapsed time.', flush=True)
        time.sleep(3)
    vast.configure(SimpleNamespace(ssh_command='ssh -p %d root@%s' % (args.port, args.host),
                                   identity=args.identity, local_port=8188, instance_id=args.instance_id))
    print('RECAST_STAGE Uploading the small deployment package', flush=True)
    vast.upload_package(config)
    root = config['remote_root']
    fast = ('test -f {r}/state/managed-provision.exit && '
            'test "$(cat {r}/state/managed-provision.exit)" = 0 && '
            'bash {r}/scripts/server.sh start && '
            '{r}/.venv/bin/python {r}/scripts/download_models.py --manifest {r}/config/optional-models.lock.json --model-dir {r}/models --verify-only && '
            '{r}/.venv/bin/python {r}/scripts/doctor.py').format(r=shlex.quote(root))
    ready = subprocess.run(vast.ssh_arguments(config) + ['-T', vast.destination(config), shlex.join(['bash', '-lc', fast])],
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
    if ready.returncode == 0:
        print('RECAST_STAGE Existing installation verified; reusing cached models', flush=True)
        vast.tunnel(config, browser=False)
        return
    # Keep installation on the host if this Mac or its network disconnects.
    launch = ('if ! command -v flock >/dev/null || ! command -v python3 >/dev/null; then '
              'apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3 util-linux; fi; '
              'mkdir -p {r}/state; if flock -n {r}/state/managed-provision.lock true; then '
              'rm -f {r}/state/managed-provision.exit; '
              'nohup bash {r}/scripts/managed_bootstrap.sh >> {r}/state/managed-provision.log 2>&1 < /dev/null & '
              'echo "Installation started"; else echo "Following the existing installation"; fi').format(r=shlex.quote(root))
    vast.remote(config, ['bash', '-lc', launch])
    offset, failures = 0, 0
    inspect = '''import fcntl,json,os,sys
from pathlib import Path
r=Path(sys.argv[1])/'state'; p=r/'managed-provision.log'; offset=int(sys.argv[2])
lock=open(r/'managed-provision.lock','a'); running=False
try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
except BlockingIOError: running=True
data=b''
if p.exists():
    with p.open('rb') as f:
        size=os.fstat(f.fileno()).st_size
        f.seek(min(offset,size));data=f.read(128000);offset=f.tell()
code=(r/'managed-provision.exit').read_text().strip() if (r/'managed-provision.exit').exists() else None
print(json.dumps({'running':running,'offset':offset,'text':data.decode(errors='replace'),'code':code}))
'''
    time.sleep(2)
    while True:
        try:
            raw = subprocess.check_output(vast.ssh_arguments(config) + ['-T', vast.destination(config),
                                           shlex.join(['python3', '-c', inspect, root, str(offset)])],
                                          stderr=subprocess.PIPE, timeout=25)
            state = json.loads(raw); offset = state['offset']; failures = 0
            if state['text']:
                print(state['text'], end='' if state['text'].endswith('\n') else '\n', flush=True)
            if not state['running'] and state['code'] is not None:
                if state['code'] != '0':
                    raise SystemExit('Remote setup failed with exit code ' + state['code'] + '. Downloaded model parts are kept for retry.')
                break
        except (subprocess.SubprocessError, OSError, ValueError) as error:
            failures += 1
            print('Setup connection interrupted; reconnecting to the existing installation.', flush=True)
            if failures >= 6:
                print('RECAST_WARNING Setup monitoring is temporarily unavailable. Reconnecting to the same remote installation.', flush=True)
        time.sleep(4)
    print('RECAST_STAGE Connecting the private ComfyUI tunnel', flush=True)
    vast.tunnel(config, browser=False)


if __name__ == '__main__':
    try:
        main()
    except (subprocess.SubprocessError, OSError, ValueError) as error:
        raise SystemExit(str(error)) from error
