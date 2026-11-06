#!/usr/bin/env python3
"""Run the current file helper over the existing exact-rental SSH connection."""
import argparse
import json
import os
from pathlib import Path
import vast
from managed_models import check_connection
from gpu_files import parts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--instance-id', type=int, required=True)
    parser.add_argument('--request', required=True)
    parser.add_argument('--delete', action='store_true')
    args = parser.parse_args()
    request = json.loads(args.request)
    if request.get('instanceId') != args.instance_id:
        raise ValueError('The selected file belongs to a different GPU.')
    parts(request.get('path'), empty=not args.delete)
    config = vast.load()
    check_connection(config, args.instance_id)
    os.environ['RECAST_SSH_BATCH'] = '1'
    command = ['python3', '-c', Path(__file__).with_name('gpu_files.py').read_text(), '--workspace', config['remote_root'], '--request', json.dumps(request)]
    if args.delete:
        command.append('--delete')
    vast.remote(config, command)


if __name__ == '__main__':
    main()
