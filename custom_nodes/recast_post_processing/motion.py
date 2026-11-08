"""Bounded-memory, exact-time RIFE finishing. No network or implicit models."""
from fractions import Fraction
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import tempfile

MODEL = 'rife_v4.25.safetensors'
MODEL_SHA256 = '1505884b9bdae956795430d2a70f7e2317b2abd8f130f8cfdb35a5759f909481'
VERSION = 'smooth-motion-v1'


def sha256(file):
    h = hashlib.sha256()
    with Path(file).open('rb') as f:
        for b in iter(lambda: f.read(4 * 1024 * 1024), b''): h.update(b)
    return h.hexdigest()


def output_count(duration, fps):
    return max(1, math.ceil(Fraction(str(duration)) * fps - Fraction(1, 1000000)))


def sample_position(index, source_fps, target_fps):
    value = Fraction(index * source_fps.numerator, target_fps * source_fps.denominator)
    left = value.numerator // value.denominator
    return left, float(value - left)


def scene_cut(a, b):
    """Conservative shot boundary veto; never synthesize across a detected cut."""
    import numpy as np
    a = a[::max(1, a.shape[0] // 48), ::max(1, a.shape[1] // 48)].astype('float32') / 255
    b = b[::max(1, b.shape[0] // 48), ::max(1, b.shape[1] // 48)].astype('float32') / 255
    difference = float(np.abs(a - b).mean())
    hist_a = np.concatenate([np.histogram(a[..., c], bins=16, range=(0, 1))[0] for c in range(3)]).astype(float)
    hist_b = np.concatenate([np.histogram(b[..., c], bins=16, range=(0, 1))[0] for c in range(3)]).astype(float)
    distance = float(np.abs(hist_a / hist_a.sum() - hist_b / hist_b.sum()).sum() / 2)
    return difference > .22 and distance > .45


def probe(file):
    value = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(file)], timeout=30))
    video = next(s for s in value['streams'] if s['codec_type'] == 'video')
    fps = Fraction(video.get('avg_frame_rate') or video['r_frame_rate'])
    duration = float(video.get('duration') or value['format']['duration'])
    if not 0 < duration <= 300 or not 0 < fps <= 240 or max(video['width'], video['height']) > 4096:
        raise ValueError('Smooth Motion supports SDR videos up to five minutes and 4096 pixels per edge.')
    if video.get('color_transfer') in ('smpte2084', 'arib-std-b67'):
        raise ValueError('Convert HDR footage to SDR before using Smooth Motion.')
    audio = next((s for s in value['streams'] if s['codec_type'] == 'audio'), None)
    rotation = next((s.get('rotation', 0) for s in video.get('side_data_list', []) if 'rotation' in s), video.get('tags', {}).get('rotate', 0))
    rotation = int(round(float(rotation))) % 360
    if rotation % 90: raise ValueError('Convert footage with a non-right-angle rotation to an upright video first.')
    w, h = (video['height'], video['width']) if rotation in (90, 270) else (video['width'], video['height'])
    if w % 2 or h % 2: raise ValueError('Smooth Motion needs even pixel dimensions for its playable H.264 export.')
    return {'width': w, 'height': h, 'fps': fps, 'duration': duration, 'audio': audio}


def read_frame(stream, count):
    chunks = bytearray()
    while len(chunks) < count:
        block = stream.read(count - len(chunks))
        if not block:
            if chunks: raise ValueError('The video decoder returned an incomplete frame.')
            return None
        chunks.extend(block)
    return bytes(chunks)


def finish_video(source, output, target_fps, predict, check=lambda: None, progress=lambda *_: None):
    """Only two decoded frames and one prediction are retained at a time.

    FFmpeg conforms variable input timing to its measured average FPS; the
    output timeline is sampled at exact rational times, never sped up.
    """
    import numpy as np
    meta = probe(source); w, h, rate = meta['width'], meta['height'], meta['fps']
    total = output_count(meta['duration'], target_fps)
    audio_codec = 'copy' if not meta['audio'] or meta['audio'].get('codec_name') in ('aac', 'mp3', 'ac3', 'alac') else 'aac'
    counters = {'frames': total, 'interpolated': 0, 'cutFrames': 0, 'edgeHolds': 0, 'sourceFPS': str(rate), 'targetFPS': target_fps, 'audio': bool(meta['audio']), 'audioCodec': audio_codec}
    with tempfile.TemporaryFile() as decode_log, tempfile.TemporaryFile() as encode_log:
        decoder = subprocess.Popen(['ffmpeg', '-v', 'error', '-nostdin', '-i', str(source), '-an', '-sn', '-vf', f'fps={rate}:start_time=0', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'], stdout=subprocess.PIPE, stderr=decode_log)
        encoder = None
        try:
            encoder = subprocess.Popen(['ffmpeg', '-v', 'error', '-nostdin', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{w}x{h}', '-r', str(target_fps), '-i', 'pipe:0', '-i', str(source), '-map', '0:v:0', '-map', '1:a:0?', '-c:v', 'libx264', '-preset', 'fast', '-crf', '16', '-threads', str(min(8, os.cpu_count() or 2)), '-pix_fmt', 'yuv420p', '-c:a', audio_codec, '-t', str(total / target_fps), '-movflags', '+faststart', str(output)], stdin=subprocess.PIPE, stderr=encode_log)
            def frame():
                data = read_frame(decoder.stdout, w * h * 3)
                return None if data is None else np.frombuffer(data, dtype=np.uint8).reshape(h, w, 3).copy()
            left = frame()
            if left is None: raise ValueError('The source video contains no decodable frames.')
            right = frame(); current = 0; cut = right is not None and scene_cut(left, right)
            for index in range(total):
                check(); wanted, t = sample_position(index, rate, target_fps)
                while current < wanted and right is not None:
                    left, right = right, frame(); current += 1
                    cut = right is not None and scene_cut(left, right)
                if right is None:
                    if wanted > current + 1: raise ValueError('The source ended before its declared timeline. No result was published.')
                    result = left; counters['edgeHolds'] += int(t > 0 or wanted > current)
                elif t == 0: result = left
                elif cut:
                    # The new shot starts at the RIGHT source timestamp. Keep
                    # the old shot until then rather than moving the cut early.
                    result = left; counters['cutFrames'] += 1
                else:
                    result = predict(left, right, t); counters['interpolated'] += 1
                encoder.stdin.write(np.asarray(result, dtype=np.uint8).tobytes()); progress(index + 1, total)
            encoder.stdin.close()
            if encoder.wait() != 0:
                encode_log.seek(0); raise ValueError('Video encoding failed: ' + encode_log.read().decode(errors='replace')[-1200:])
            # Decoder can have unread tail frames after the final output sample.
            # Terminate it below instead of waiting on a full stdout pipe.
        finally:
            for process in (decoder, encoder):
                if process is not None and process.poll() is None:
                    process.terminate()
                    try: process.wait(timeout=5)
                    except subprocess.TimeoutExpired: process.kill(); process.wait()
                if process is not None:
                    for stream in (process.stdin, process.stdout):
                        if stream is not None:
                            try: stream.close()
                            except OSError: pass
    result = probe(output)
    if result['width'] != w or result['height'] != h or result['fps'] != target_fps or bool(result['audio']) != bool(meta['audio']) or abs(result['duration'] - meta['duration']) > 1 / target_fps + .003:
        raise ValueError('Finished video timing, audio or framing validation failed.')
    return counters


class RecastSmoothVideoV1:
    @classmethod
    def INPUT_TYPES(cls):
        # Do not advertise a static model-file combo: Studio's physical-loader
        # inventory must decide whether the weight is actually installed.
        return {'required': {'video': ('STRING', {'default': ''}), 'source_sha256': ('STRING', {'default': ''}), 'target_fps': ([30, 48, 60],), 'run_id': ('STRING', {'default': ''}), 'model_name': ('STRING', {'default': MODEL})}}
    RETURN_TYPES = ()
    OUTPUT_NODE = True
    FUNCTION = 'process'
    CATEGORY = 'Recast/Post-processing'

    def process(self, video, source_sha256, target_fps, run_id, model_name):
        import numpy as np
        import torch
        import torch.nn.functional as F
        import folder_paths
        import comfy.model_management as mm
        import comfy.utils
        from comfy_extras.nodes_frame_interpolation import FrameInterpolationModelLoader
        if not re.fullmatch(r'[a-f0-9-]{36}', run_id) or not re.fullmatch(r'[a-f0-9]{64}', source_sha256): raise ValueError('Invalid saved smoothing request.')
        root = Path(folder_paths.get_input_directory()).resolve(); source = (root / video).resolve(); source.relative_to(root)
        if not source.is_file() or sha256(source) != source_sha256: raise ValueError('The uploaded source differs from the saved video.')
        model_file = folder_paths.get_full_path_or_raise('frame_interpolation', model_name)
        if model_name != MODEL or sha256(model_file) != MODEL_SHA256: raise ValueError('Download the pinned RIFE model before processing.')
        folder = Path(folder_paths.get_output_directory()) / 'recast-smooth' / run_id; folder.mkdir(parents=True, exist_ok=True)
        final = folder / 'final.mp4'; receipt = folder / 'receipt.json'
        request = {'version': VERSION, 'sourceSHA256': source_sha256, 'modelSHA256': MODEL_SHA256, 'targetFPS': target_fps, 'runId': run_id}
        if receipt.is_file() and final.is_file():
            old = json.loads(receipt.read_text())
            if old.get('request') == request and old.get('outputSHA256') == sha256(final): return self.result(run_id)
            raise ValueError('An existing finished video has a different saved request. It was kept.')
        meta = probe(source)
        loaded = FrameInterpolationModelLoader.execute(model_name).result[0]
        device, dtype, model = loaded.load_device, loaded.model_dtype(), loaded.model
        shape = (1, meta['height'], meta['width'], 3)
        mm.load_models_gpu([loaded], memory_required=model.memory_used_forward(shape, dtype))
        last_pair = None; cache = {}; pair_tensors = None
        def tensor(image):
            x = torch.from_numpy(image).to(device=device, dtype=dtype).permute(2, 0, 1)[None] / 255
            align = getattr(model, 'pad_align', 32); ph = (-x.shape[2]) % align; pw = (-x.shape[3]) % align
            return F.pad(x, (0, pw, 0, ph), mode='replicate') if ph or pw else x
        def predict(a, b, t):
            nonlocal last_pair, cache, pair_tensors
            if last_pair is None or last_pair[0] is not a or last_pair[1] is not b:
                x0, x1 = tensor(a), tensor(b)
                cache = {'img0': model.extract_features(x0), 'img1': model.extract_features(x1)}
                pair_tensors = (x0, x1); last_pair = (a, b)
            x0, x1 = pair_tensors
            step = torch.full((1, 1, x0.shape[2], x0.shape[3]), t, device=device, dtype=dtype)
            result = model(x0, x1, timestep=step, cache=cache)
            return (result[0, :, :meta['height'], :meta['width']].permute(1, 2, 0).clamp(0, 1) * 255).round().byte().cpu().numpy()
        bar = comfy.utils.ProgressBar(output_count(meta['duration'], target_fps))
        partial = folder / 'partial.mp4'
        try:
            with torch.inference_mode(): counters = finish_video(source, partial, target_fps, predict, mm.throw_exception_if_processing_interrupted, lambda n, total: bar.update_absolute(n, total))
            if sha256(source) != source_sha256: raise ValueError('The uploaded source changed while processing. No result was published.')
            partial.replace(final)
            record = {'complete': True, 'request': request, 'outputSHA256': sha256(final), **counters}
            temporary = receipt.with_suffix('.tmp'); temporary.write_text(json.dumps(record)); temporary.replace(receipt)
        finally:
            partial.unlink(missing_ok=True)
        return self.result(run_id)

    @staticmethod
    def result(run_id):
        return {'ui': {'videos': [{'filename': 'final.mp4', 'subfolder': 'recast-smooth/' + run_id, 'type': 'output'}]}}
