#!/usr/bin/env python3
"""Exact local source reversal and directional assembly; never performs inference."""
import argparse
from fractions import Fraction
import hashlib
import json
from pathlib import Path
import signal
import subprocess
import sys

ACTIVE = None


def sha(file):
    digest = hashlib.sha256()
    with Path(file).open('rb') as stream:
        for block in iter(lambda: stream.read(4*1024**2), b''):
            digest.update(block)
    return digest.hexdigest()


def run(args):
    global ACTIVE
    ACTIVE = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        out, err = ACTIVE.communicate()
        if ACTIVE.returncode:
            raise ValueError(err.decode(errors='replace')[-2000:])
        return out.decode()
    finally:
        if ACTIVE.poll() is None:
            ACTIVE.terminate()
            ACTIVE.wait()
        ACTIVE = None


def interrupted(_signal, _frame):
    if ACTIVE and ACTIVE.poll() is None:
        ACTIVE.terminate()
    raise SystemExit(130)


def info(file):
    value = json.loads(run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries',
        'stream=width,height,avg_frame_rate,nb_read_frames,start_time', '-of', 'json', str(file)]))['streams'][0]
    result = {'frames': int(value['nb_read_frames']), 'width': int(value['width']), 'height': int(value['height']),
              'fps': str(Fraction(value['avg_frame_rate'])), 'start': float(value.get('start_time', 0))}
    if result['fps'] != '24' or abs(result['start']) > .001:
        raise ValueError('Directional video must have exact 24 fps and a zero start timestamp. Nothing was padded.')
    return result


def hashes(file):
    lines = run(['ffmpeg', '-v', 'error', '-nostdin', '-i', str(file), '-map', '0:v:0', '-an', '-pix_fmt', 'yuv420p',
                 '-c:v', 'rawvideo', '-f', 'framehash', '-hash', 'sha256', '-']).splitlines()
    return [line.rsplit(',', 1)[-1].strip() for line in lines if line and not line.startswith('#')]


def atomic(file, data):
    temporary = file.with_suffix('.tmp.json')
    temporary.write_text(json.dumps(data)+'\n')
    temporary.replace(file)


def saved(receipt, request, folder):
    if not receipt.exists():
        return None
    old = json.loads(receipt.read_text())
    if old['inputs'] != request:
        raise ValueError('Saved directional media belongs to different frozen inputs. Paid output was preserved.')
    if any(not (folder/name).is_file() or sha(folder/name) != value for name, value in old['outputs'].items()):
        raise ValueError('Saved directional media changed. Restore its original file; no paid inference was repeated.')
    return old


def prepare(folder, request):
    root = folder/'anchor-media'
    root.mkdir(exist_ok=True)
    source = folder/'prepared-source.mp4'
    if sha(source) != request['sourceSHA256']:
        raise ValueError('Prepared source changed before directional extraction.')
    actual = info(source)
    frames, anchor = request['frames'], request['anchorFrame']
    if request['version'] != 'bidirectional-v1' or request['fps'] != 24 or not isinstance(anchor, int) or not 4 <= anchor <= frames-5 or actual['frames'] != frames or any(actual[k] != request[k] for k in ['width', 'height']):
        raise ValueError('Invalid directional frame range or source canvas. No inference was submitted.')
    receipt = root/'sources.json'
    old = saved(receipt, request, root)
    if old:
        return old
    source_hashes = hashes(source)
    if len(source_hashes) != frames:
        raise ValueError('Source decoded frame count changed.')
    outputs = {}
    for direction, trim, mapping in [
        ('backward', f'trim=start_frame=0:end_frame={anchor+1},reverse', list(range(anchor, -1, -1))),
        ('forward', f'trim=start_frame={anchor}:end_frame={frames}', list(range(anchor, frames))),
    ]:
        partial = root/(direction+'.part.mkv')
        run(['ffmpeg', '-v', 'error', '-nostdin', '-y', '-i', str(source), '-map', '0:v:0', '-an',
             '-vf', trim+',setpts=N/(24*TB)', '-frames:v', str(len(mapping)), '-c:v', 'ffv1', '-level', '3', '-pix_fmt', 'yuv420p', str(partial)])
        actual = info(partial)
        if actual['frames'] != len(mapping) or hashes(partial) != [source_hashes[n] for n in mapping]:
            raise ValueError('Directional extraction changed decoded frames or timing. No inference was submitted.')
        file = root/(direction+'.mkv')
        partial.replace(file)
        outputs[file.name] = sha(file)
    result = {'inputs': request, 'outputs': outputs, 'decodedFramesExact': True,
              'backwardFrames': anchor+1, 'forwardFrames': frames-anchor, 'sourceAnchorCopies': 2}
    atomic(receipt, result)
    return result


def assemble(folder, request):
    root = folder/'anchor-media'
    source = folder/'prepared-source.mp4'
    if request['version'] != 'bidirectional-v1' or request['fps'] != 24 or sha(source) != request['sourceSHA256']:
        raise ValueError('The original prepared clip changed; both paid branches were kept.')
    source_info = info(source)
    if source_info['frames'] != request['frames']:
        raise ValueError('The frozen source frame range changed; both paid branches were kept.')
    # Exact 720p exports are downsampled in each saved native graph. Joining
    # preserves those exported pixels; source preparation stays patch-aligned.
    canvas = {key: request.get(key, source_info[key]) for key in ['width', 'height']}
    if any(not isinstance(value, int) or value < 2 or value % 2 for value in canvas.values()):
        raise ValueError('Invalid frozen directional export canvas.')
    branches = request['branches']
    if [b['direction'] for b in branches] != ['backward', 'forward'] or [b['frames'] for b in branches] != [request['anchorFrame']+1, request['frames']-request['anchorFrame']]:
        raise ValueError('Directional ranges do not cover the frozen clip exactly.')
    for branch in branches:
        actual = info(branch['file'])
        if sha(branch['file']) != branch['sha256'] or actual['frames'] != branch['frames'] or any(actual[k] != canvas[k] for k in ['width', 'height']):
            raise ValueError('A saved paid branch changed; it was not regenerated.')
    receipt = root/'assembly.json'
    old = saved(receipt, request, folder)
    if old:
        return old
    back, forward = (Path(b['file']) for b in branches)
    # Reversing the earlier branch gives source order. Drop only its duplicated
    # anchor; the later branch supplies that single frame. Never crossfade motion.
    filters = f'[0:v]reverse,trim=end_frame={request["anchorFrame"]},setpts=N/(24*TB)[b];[1:v]setpts=N/(24*TB)[f];[b][f]concat=n=2:v=1:a=0[v]'
    partial = root/'master.part.mkv'
    run(['ffmpeg', '-v', 'error', '-nostdin', '-y', '-i', str(back), '-i', str(forward),
         '-filter_complex', filters, '-map', '[v]', '-an', '-frames:v', str(request['frames']),
         '-c:v', 'ffv1', '-level', '3', '-pix_fmt', 'yuv420p', str(partial)])
    expected = list(reversed(hashes(back)))[:-1] + hashes(forward)
    if info(partial)['frames'] != request['frames'] or hashes(partial) != expected or len(expected) != request['frames']:
        raise ValueError('Directional joining changed decoded frames or timing. Both paid branches were retained.')
    master = root/'master.mkv'
    partial.replace(master)
    preview = folder/'final.part.mp4'
    run(['ffmpeg', '-v', 'error', '-nostdin', '-y', '-i', str(master), '-i', str(source), '-map', '0:v:0', '-map', '1:a?',
         '-frames:v', str(request['frames']), '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p',
         '-c:a', 'copy', '-movflags', '+faststart', str(preview)])
    if info(preview)['frames'] != request['frames']:
        raise ValueError('Playable export frame count changed. The lossless master was kept.')
    final = folder/'final.mp4'
    preview.replace(final)
    result = {'inputs': request, 'frames': request['frames'], 'anchorCopies': 1, 'decodedFramesExact': True,
              'masterSHA256': sha(master), 'outputSHA256': sha(final), 'outputs': {'anchor-media/master.mkv': sha(master), 'final.mp4': sha(final)},
              'mapping': {'earlier': f'backward frames {request["anchorFrame"]} through 1 in reverse order', 'anchorAndLater': 'all forward frames in order'},
              'audio': 'playable output copies original prepared source once; FFV1 master is video-only', 'preview': 'H.264 CRF 16; decoded YUV pixels preserved exactly in FFV1 master'}
    atomic(receipt, result)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['prepare', 'assemble'])
    parser.add_argument('--folder', type=Path, required=True)
    parser.add_argument('--request', type=Path, required=True)
    args = parser.parse_args()
    request = json.loads(args.request.read_text())
    print(json.dumps((prepare if args.action == 'prepare' else assemble)(args.folder, request)))


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
