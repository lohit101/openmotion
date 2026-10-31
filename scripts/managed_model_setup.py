"""Observe a saved preparation without tying package installation to SSH."""
import json
import subprocess
import time
import uuid

import vast
from managed_model_download import upload
from model_download_worker import key_for


def prepare(config,version,profile,cancelled=lambda:False):
    # New explicit requests get a fresh tracked attempt. A lost RPC response
    # only polls this same request and never starts another setup process.
    request={'kind':'facial','version':version,'profile':profile,'attempt':str(uuid.uuid4())}
    key=key_for(request);script=upload(config).with_name('model_setup_worker.py');started=False
    while True:
        if cancelled():raise RuntimeError('Stopped observing facial setup. Check the saved runtime on the same GPU before continuing.')
        action='status'if started else'start';started=True
        try:
            value=vast.remote(config,['python3',str(script),action,'--root',config['remote_root'],'--request',json.dumps(request)],capture_output=True,text=True,timeout=25)
            lines=[line[19:]for line in value.stdout.splitlines()if line.startswith('RECAST_SETUP_STATE ')]
            if not lines:raise RuntimeError('No runtime-setup status was returned.')
            state=json.loads(lines[-1])
            if state.get('requestSHA256')!=key:raise RuntimeError('Runtime-setup status belongs to another request.')
        except (OSError,subprocess.SubprocessError,ValueError,RuntimeError):
            print('RECAST_FACIAL_STAGE Reconnecting to the existing facial-tool setup',flush=True);time.sleep(3);continue
        if state['confirmedStopped']:
            if state.get('complete'):return
            raise RuntimeError(state.get('error')or'Facial setup stopped. Retry from Download Remotion; existing weights are kept.')
        print('RECAST_FACIAL_STAGE Preparing the selected facial tools',flush=True);time.sleep(2)
