"""GB10 shared memory does not masquerade as missing discrete VRAM."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from resources import gpu_memory_mib


class GpuMemoryTests(unittest.TestCase):
    def test_gb10_missing_memory_uses_the_container_limit(self):
        self.assertEqual(gpu_memory_mib('NVIDIA GB10', '[N/A]', 128*1024**3), 131072)

    def test_gb10_cannot_count_more_than_its_container_allocation(self):
        self.assertEqual(gpu_memory_mib('NVIDIA GB10', '131072', 64*1024**3), 65536)

    def test_discrete_memory_is_preserved_and_unknown_memory_still_fails(self):
        self.assertEqual(gpu_memory_mib('NVIDIA RTX 3090', '24576', 64*1024**3), 24576)
        with self.assertRaises(ValueError):
            gpu_memory_mib('NVIDIA RTX 3090', '[N/A]', 128*1024**3)
