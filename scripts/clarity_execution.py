"""Bounded Clarity execution adapters; no model downloads or inference on import.

Keep the pinned FlashVSR model, decoder history and wavelet color algorithm.
Only input transport, color-pass device and execution diagnostics change.
"""
from contextlib import contextmanager
import math
import json
import os
from pathlib import Path
import subprocess
import time


def cpu_threads():
    """Bound CPU helpers to the rental's affinity/quota, with an eight-thread cap."""
    count = os.cpu_count() or 1
    if hasattr(os, 'sched_getaffinity'):
        count = min(count, len(os.sched_getaffinity(0)))
    for file in (Path('/sys/fs/cgroup/cpu.max'),):
        try:
            quota, period = file.read_text().split()
            if quota != 'max':
                count = min(count, max(1, math.ceil(int(quota) / int(period))))
        except (OSError, ValueError):
            pass
    return max(1, min(8, count))


class PhaseTimings:
    def __init__(self):
        self.seconds = {}

    @contextmanager
    def measure(self, name):
        started = time.monotonic()
        try:
            yield
        finally:
            self.seconds[name] = self.seconds.get(name, 0) + time.monotonic() - started


def processing_geometry(request):
    target = request['geometry']
    actual = request.get('processingGeometry', target)
    fast = request['settings'].get('processing') == 'fast1080'
    if fast:
        if request['settings']['height'] != 1080 or min(request['input']['width'], request['input']['height']) >= 720:
            raise ValueError('Fast 1080p needs an input below 720p and 1080p output.')
        ratio = 720 / min(request['input']['width'], request['input']['height'])
        # Match JavaScript Math.round for positive pixel dimensions.
        w = math.floor(request['input']['width'] * ratio / 2 + .5) * 2
        h = math.floor(request['input']['height'] * ratio / 2 + .5) * 2
        ww, wh = math.ceil(w / 128) * 128, math.ceil(h / 128) * 128
        expected = dict(outputWidth=w, outputHeight=h, workWidth=ww, workHeight=wh,
                        padX=((ww-w)//4)*2, padY=((wh-h)//4)*2)
        if actual != expected:
            raise ValueError('The frozen Fast 1080p processing geometry changed.')
    elif actual != target:
        raise ValueError('Native upscaling must process at the chosen output resolution.')
    return actual


def export_filter(processing, target):
    if (processing['outputWidth'], processing['outputHeight']) == (target['outputWidth'], target['outputHeight']):
        return 'setsar=1'
    return f'scale={target["outputWidth"]}:{target["outputHeight"]}:flags=lanczos,setsar=1'


def input_filter(geometry):
    g = geometry
    # Match v2's YUV420 sampling. Decode that raw stream with the same OpenCV
    # FFmpeg backend as upstream, retaining its exact YUV->RGB conversion.
    return (f'setpts=PTS-STARTPTS,scale={g["outputWidth"]}:{g["outputHeight"]}:flags=lanczos,'
            f'pad={g["workWidth"]}:{g["workHeight"]}:{g["padX"]}:{g["padY"]}:color=black,'
            'setsar=1,format=yuv420p')


def streamed_input(source, geometry, expected, *, chunk_frames, first_chunk_frames=None,
                   timings=None, threads=None, stream=True, stats=None):
    """Yield exact CFR RGB windows from a lossless pipe, without a prepared file.

    EOF counts are checked even for partial final windows. A closed/failed model
    runner closes its generator and terminates the decoder, without orphan pipes.
    """
    import numpy as np
    import torch
    import cv2
    if chunk_frames <= 0 or first_chunk_frames is not None and first_chunk_frames <= 0:
        raise ValueError('Invalid Clarity input window.')
    g = geometry
    # NUT/rawvideo omits matrix/range metadata in this FFmpeg/OpenCV interface.
    # Tagged footage therefore uses an in-memory FFV1/Matroska pipe; no disk
    # intermediate or quality conversion is introduced. This preserves v2 RGB.
    profile=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0',
                      '-show_entries','stream=color_range,color_space','-of','json',str(source)]))['streams'][0]
    tagged=profile.get('color_range')not in (None,'unknown','tv') or profile.get('color_space')not in (None,'unknown')
    codec=['-c:v','ffv1','-level','1','-threads',str(threads or cpu_threads()),'-f','matroska'] if tagged else ['-c:v','rawvideo','-f','nut']
    if stats is not None:
        stats['inputTransport']='ffv1-matroska' if tagged else 'raw-yuv-nut'
    command = ['ffmpeg', '-v', 'error', '-nostdin', '-threads', str(threads or cpu_threads()),
               '-i', str(source), '-an', '-sn', '-dn', '-vf', input_filter(g),
               '-filter_threads', str(threads or cpu_threads()), '-fps_mode', 'passthrough',
               *codec, '-pix_fmt', 'yuv420p', 'pipe:1']
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    capture = None
    count = 0
    frames = []
    window = first_chunk_frames or chunk_frames
    started = time.monotonic()
    elapsed = 0.0
    active = True
    try:
        capture = cv2.VideoCapture('pipe:' + str(process.stdout.fileno()), cv2.CAP_FFMPEG)
        if not capture.isOpened():
            raise ValueError('Clarity could not open its lossless input stream.')
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            if frame.shape != (g['workHeight'], g['workWidth'], 3):
                raise ValueError('Clarity input decoder returned unexpected frame geometry.')
            count += 1
            if count > expected['frames']:
                raise ValueError('Clarity input decoded more frames than the validated source.')
            frames.append(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            if len(frames) == window:
                value = _input_tensor(frames, torch, np)
                frames.clear()
                elapsed += time.monotonic() - started
                active = False
                yield value
                del value
                started = time.monotonic()
                active = True
                window = chunk_frames
        code = process.wait()
        error = process.stderr.read().decode(errors='replace')[-1000:]
        if code or count != expected['frames']:
            raise ValueError(f'Clarity input decoding/timing failed ({count}/{expected["frames"]} frames): {error}')
        if frames:
            value = _input_tensor(frames, torch, np)
            frames.clear()
            elapsed += time.monotonic() - started
            active = False
            yield value
            started = time.monotonic()
            active = True
    finally:
        if active:
            elapsed += time.monotonic() - started
        if capture is not None:
            capture.release()
        process.stdout.close()
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        process.stderr.close()
        if timings is not None:
            timings.seconds['inputStreaming'] = elapsed


def _input_tensor(frames, torch, np):
    array = np.ascontiguousarray(np.stack(frames))
    return (torch.from_numpy(array).permute(0, 3, 1, 2).float().div_(127.5).sub_(1.0)
            .permute(1, 0, 2, 3).unsqueeze(0))


class DeviceColorCorrector:
    """Same upstream float32 wavelet pass, in bounded CUDA windows when feasible.

    A color-only OOM retries just that small window on CPU. It never reruns or
    changes diffusion, decoder state, frame count, color levels or identity.
    TF32 convolutions are disabled only within this finishing pass.
    """
    def __init__(self, factory, *, levels=5, chunk_size=16, timings=None, stats=None,
                 torch_module=None):
        if torch_module is None:
            import torch as torch_module
        self.torch = torch_module
        self.native = factory(levels=levels, chunk_size=min(2, chunk_size))
        self.chunk_size = min(2, chunk_size)
        self.timings = timings or PhaseTimings()
        self.stats = stats if stats is not None else {}
        self.stats.update(colorCUDAFrames=0, colorCPUFrames=0, colorOOMFallbacks=0)

    def __call__(self, generated, reference):
        torch = self.torch
        if generated.shape != reference.shape or generated.ndim != 5:
            raise ValueError('Color matching requires aligned [B,C,F,H,W] inputs.')
        with self.timings.measure('colorMatching'):
            output = torch.empty_like(generated)
            for start in range(0, generated.shape[2], self.chunk_size):
                stop = min(start + self.chunk_size, generated.shape[2])
                content = generated[:, :, start:stop]
                style = reference[:, :, start:stop]
                # Account for float inputs, padded intermediates and convolution
                # workspaces, retaining another GiB for the resident model/cache.
                reserve = content.numel() * 4 * 20 + 1024**3
                use_cuda = torch.cuda.is_available() and torch.cuda.mem_get_info(0)[0] >= reserve
                corrected = None
                if use_cuda:
                    old_tf32 = torch.backends.cudnn.allow_tf32
                    try:
                        torch.backends.cudnn.allow_tf32 = False
                        with torch.inference_mode():
                            corrected = self.native(content.to('cuda:0'), style.to('cuda:0')).to(generated.device)
                        self.stats['colorCUDAFrames'] += stop - start
                    except torch.cuda.OutOfMemoryError:
                        self.stats['colorOOMFallbacks'] += 1
                    finally:
                        torch.backends.cudnn.allow_tf32 = old_tf32
                    if corrected is None:
                        torch.cuda.empty_cache()
                if corrected is None:
                    corrected = self.native(content, style)
                    self.stats['colorCPUFrames'] += stop - start
                output[:, :, start:stop] = corrected
            return output


def move_verified_bridge(video, _audio_source, destination):
    """The pipeline already verified RGB; copy original audio in final export only."""
    os.replace(video, destination)
