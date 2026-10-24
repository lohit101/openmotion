"""Read effective container RAM without mistaking host RAM for the rental limit."""

import os
from pathlib import Path


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
