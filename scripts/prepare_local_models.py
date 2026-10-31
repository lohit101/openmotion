#!/usr/bin/env python3
"""Explicit selected local setup, with resumable blobs and one setup owner.

The legacy setup/inference modules stay unchanged. Their pinned file URLs are
served from a checksum-verified resumable local download before legacy setup
copies/verifies them into place. No image/video inference runs here.
"""
import argparse
import fcntl
import json
from pathlib import Path
import urllib.request

import download_models
import local_identity
import local_pose
from model_manifest import is_content_filter_weight

ROOT=Path(__file__).resolve().parents[1]


def prepare(kind):
    module=local_identity if kind=='localIdentity'else local_pose
    config=json.loads(module.LOCK.read_text())
    source=ROOT/config['source_directory']if kind=='localIdentity'else ROOT
    files=[{**item,'destination':item['path']if kind=='localIdentity'else item['destination'],'filename':Path(item['path']if kind=='localIdentity'else item['destination']).name}
           for item in config['files']if not is_content_filter_weight(item.get('path',item.get('destination','')))]
    total=sum(item['size']for item in files);counts={item['destination']:0 for item in files}
    for item in files:
        path=source/item['destination']
        if path.is_file()and path.stat().st_size==item['size']and local_identity.digest(path)==item['sha256']:counts[item['destination']]=item['size']
    original=urllib.request.urlopen;original_report=download_models.report_transfer
    def progress(item,count,phase,bytes_per_second=None):
        counts[item['destination']]=count
        print('RECAST_LOCAL_MODEL_PROGRESS '+json.dumps({'downloaded':sum(counts.values()),'total':total,'phase':phase}),flush=True)
    def pinned_open(url,*args,**kwargs):
        item=next((f for f in files if f['url']==url),None)
        if item is None:return original(url,*args,**kwargs)
        final=download_models.download(item,source)
        return final.open('rb')
    urllib.request.urlopen=pinned_open;download_models.report_transfer=progress
    try:return module.setup()
    finally:urllib.request.urlopen=original;download_models.report_transfer=original_report


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('kind',choices=['localIdentity','localPose']);parser.add_argument('--status',action='store_true');args=parser.parse_args()
    if args.status:
        file=ROOT/'.local'/(args.kind+'-setup.lock');busy=False
        if file.is_file():
            with file.open('r')as lock:
                try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
                except BlockingIOError:busy=True
        print(json.dumps({'preparing':busy}),flush=True);raise SystemExit(0)
    directory=ROOT/'.local';directory.mkdir(exist_ok=True)
    with(directory/(args.kind+'-setup.lock')).open('a')as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        print(json.dumps(prepare(args.kind)),flush=True)
