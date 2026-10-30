"""Lossless RGB bridge for the pinned FlashVSR public streaming writer API.

Only serialization/framing changes. Attention and model math stay upstream.
"""
import hashlib
from pathlib import Path
import subprocess


class ClarityVideoWriter:
    def __init__(self, path, fps, geometry, on_frame=None):
        self.destination=Path(path);self.fps=str(fps);self.geometry=geometry
        self.on_frame=on_frame;self.frame_count=0;self.process=None;self.closed=False
        self.digest=hashlib.sha256()

    def append_frame(self, frame):
        import numpy as np
        g=self.geometry
        if frame.shape!=(g['workHeight'],g['workWidth'],3)or frame.dtype!=np.uint8:
            raise ValueError('Unexpected decoded Clarity frame geometry or format.')
        frame=np.ascontiguousarray(frame[g['padY']:g['padY']+g['outputHeight'],g['padX']:g['padX']+g['outputWidth']])
        if self.process is None:
            self.destination.parent.mkdir(parents=True,exist_ok=True)
            self.process=subprocess.Popen(['ffmpeg','-v','error','-nostdin','-n','-f','rawvideo','-pixel_format','rgb24','-video_size',f'{g["outputWidth"]}x{g["outputHeight"]}',
                '-framerate',self.fps,'-i','pipe:0','-an','-c:v','ffv1','-level','3','-pix_fmt','bgr0','-threads','2',str(self.destination)],stdin=subprocess.PIPE,stderr=subprocess.PIPE)
        raw=frame.tobytes();self.digest.update(raw);self.process.stdin.write(raw);self.frame_count+=1
        if self.on_frame:self.on_frame(self.frame_count)

    def append(self, video, *, value_range='neg_one_to_one'):
        from inference.output import tensor_to_uint8_frame
        if video.ndim!=5 or video.shape[0]!=1:raise ValueError('Expected a single decoded video batch.')
        for tensor in video[0].permute(1,0,2,3):self.append_frame(tensor_to_uint8_frame(tensor,value_range=value_range))

    def close(self):
        if self.process is not None and not self.closed:
            self.process.stdin.close()
            code=self.process.wait();error=self.process.stderr.read().decode(errors='replace')[-1000:];self.process.stderr.close();self.closed=True
            if code!=0:raise ValueError('Lossless Clarity bridge encoding failed: '+error)

    def verify(self):
        from upscale_worker import info
        actual=info(self.destination);g=self.geometry
        expected={'frames':self.frame_count,'width':g['outputWidth'],'height':g['outputHeight'],'fps':self.fps}
        if actual!=expected:raise ValueError('Lossless bridge frame count, geometry or timing changed.')
        decoder=subprocess.Popen(['ffmpeg','-v','error','-i',str(self.destination),'-f','rawvideo','-pix_fmt','rgb24','-'],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        digest=hashlib.sha256()
        for block in iter(lambda:decoder.stdout.read(1024**2),b''):digest.update(block)
        code=decoder.wait();decoder.stdout.close();decoder.stderr.close()
        if code!=0 or digest.digest()!=self.digest.digest():raise ValueError('The lossless RGB bridge did not round-trip exactly.')
        return {'path':str(self.destination),**actual,'codec':'ffv1','pixel_format':'bgr0','rgbSHA256':digest.hexdigest()}
