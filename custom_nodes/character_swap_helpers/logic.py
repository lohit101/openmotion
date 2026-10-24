"""Small, model-independent rules shared by the UI nodes and batch client."""

import math


OVERLAP = 5
MAX_SHOT_FRAMES = 81


def dimensions(width, height):
    if min(width, height) < 32 or width % 32 or height % 32:
        raise ValueError("Width and height must be positive multiples of 32.")
    return width, height


def padded_length(count):
    if count < OVERLAP:
        raise ValueError("The selected source window needs at least five frames.")
    if count > MAX_SHOT_FRAMES:
        raise ValueError("Use at most 81 frames per pass; continue in another pass.")
    return math.ceil((count - 1) / 4) * 4 + 1


def next_segment(completed, target, cap=MAX_SHOT_FRAMES):
    if cap < 9 or cap > MAX_SHOT_FRAMES or (cap - 1) % 4:
        raise ValueError("Segment length must be 4n+1, between 9 and 81.")
    if completed < 0 or target < 5:
        raise ValueError("Target must contain at least five frames.")
    remaining = target - completed
    if remaining <= 0:
        return None
    overlap = OVERLAP if completed else 0
    return {"skip_frames": completed - overlap,
            "frame_cap": min(cap, remaining + overlap),
            "overlap": overlap}


def context_matches(metadata, width, height, fps, skip_frames):
    dimensions(width, height)
    for key, expected in (("width", width), ("height", height), ("count", OVERLAP)):
        if int(metadata.get(key, -1)) != expected:
            raise ValueError("Continuation context has a different %s. Clear it for a new shot." % key)
    if abs(float(metadata.get("fps", -1)) - fps) > 0.001:
        raise ValueError("Continuation context has a different frame rate.")
    if int(metadata.get("source_end_frame", -1)) != skip_frames + OVERLAP:
        raise ValueError("Wrong source offset: the next skip_frames must equal the previous source_end_frame minus five.")

