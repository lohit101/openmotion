"""Read effective container RAM without mistaking host RAM for the rental limit."""

import os
import re
from pathlib import Path


def gpu_memory_mib(name, reported, ram_bytes):
    """Read dedicated VRAM or GB10's container-limited shared memory pool."""
    unified = re.fullmatch(r'(?:NVIDIA\s+)?GB10', name.strip(), re.I) is not None
    try:
        memory = float(reported)
        if memory > 0 and memory < float('inf'):
            return min(memory, ram_bytes / 1024**2) if unified else memory
    except (TypeError, ValueError):
        pass
    if unified and re.fullmatch(r'\[?N/A\]?', str(reported).strip(), re.I) and ram_bytes > 0:
        return ram_bytes / 1024**2
    raise ValueError('The GPU did not report valid memory; cannot confirm hardware capacity.')


def effective_ram_bytes():
    host = os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")
    values = [host]
    for filename in ["/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"]:
        try:
            text = Path(filename).read_text().strip()
            if text.isdigit() and int(text) > 0:
                values.append(int(text))
        except OSError:
            pass
    return min(values)
