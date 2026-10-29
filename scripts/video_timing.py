"""Validate decoded frame timing without trusting a container's average rate.

An explicit expected rate comes from a frozen workflow, never from guessing a
replacement for variable-rate footage. No frames or timestamps are rewritten.
"""
from fractions import Fraction
import math


def decoded_video_info(data, expected_fps=None):
    streams = data.get('streams', [])
    if len(streams) != 1:
        raise ValueError('Choose a video with one readable video stream.')
    stream = streams[0]
    try:
        fps = Fraction(stream['avg_frame_rate'] if expected_fps is None else expected_fps)
    except (KeyError, TypeError, ValueError, ZeroDivisionError):
        raise ValueError('The saved video must have a known frame rate up to 60 fps.') from None
    if fps <= 0 or fps > 60:
        raise ValueError('The saved video must have a known frame rate up to 60 fps.')
    try:
        times = [float(frame['best_effort_timestamp_time']) for frame in data.get('frames', [])]
    except (KeyError, TypeError, ValueError):
        raise ValueError('Decoded video timestamps are missing or invalid.') from None
    if not times or not all(math.isfinite(value) for value in times):
        raise ValueError('Decoded video timestamps are missing or invalid.')
    if any(abs((value - times[0]) - index / float(fps)) > .001 for index, value in enumerate(times)):
        raise ValueError('Variable frame timing needs explicit preparation; no silent frame duplication or trimming is allowed.')
    return {'width': stream['width'], 'height': stream['height'], 'frames': len(times), 'fps': str(fps)}
