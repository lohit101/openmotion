"""Resource handoff must preserve active work and reject unknown GPU state."""
from contextlib import contextmanager
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import facial_memory as memory

GIB = 1024 ** 3


class FacialMemoryTests(unittest.TestCase):
    @contextmanager
    def probes(self, free):
        rows = [{'totalBytes': 32 * GIB, 'freeBytes': value * GIB} for value in free]
        with patch.object(memory, 'require_idle') as idle, patch.object(memory, 'gpu_memory', side_effect=rows), \
                patch.object(memory, 'release_idle_cache') as release, patch.object(memory.time, 'sleep'):
            yield idle, release

    def test_enough_memory_keeps_the_warm_video_cache(self):
        with self.probes([18]) as (idle, release):
            result = memory.ensure_memory(18189)
        release.assert_not_called()
        self.assertEqual(idle.call_count, 2)
        self.assertFalse(result['releasedCache'])

    def test_idle_video_cache_is_released_once_then_real_free_memory_is_verified(self):
        with self.probes([4, 4, 30]) as (idle, release):
            result = memory.ensure_memory(18189)
        release.assert_called_once_with(18189)
        self.assertEqual(result['before']['freeBytes'], 4 * GIB)
        self.assertEqual(result['after']['freeBytes'], 30 * GIB)
        self.assertTrue(result['releasedCache'])
        self.assertGreaterEqual(idle.call_count, 5)

    def test_work_arriving_during_the_memory_probe_is_not_unloaded(self):
        with self.probes([4]) as (idle, release):
            idle.side_effect = [None, ValueError('New work')]
            with self.assertRaisesRegex(ValueError, 'New work'):
                memory.ensure_memory(18189)
        release.assert_not_called()

    def test_a_new_queue_entry_during_release_stops_admission(self):
        with self.probes([4]) as (idle, release):
            idle.side_effect = [None, None, ValueError('New queued work')]
            with self.assertRaisesRegex(ValueError, 'New queued work'):
                memory.ensure_memory(18189)
        release.assert_called_once()

    def test_failed_release_never_loads_models_or_restarts_compute(self):
        with self.probes([4]) as (_, release):
            with self.assertRaisesRegex(ValueError, 'rendered video and disk models were kept'):
                memory.ensure_memory(18189, timeout=0)
        release.assert_called_once()

    def test_cancellation_stops_before_cache_mutation(self):
        with self.probes([4]) as (_, release):
            with self.assertRaisesRegex(ValueError, 'cancelled before launch'):
                memory.ensure_memory(18189, cancelled=lambda: True)
        release.assert_not_called()

    def test_unknown_queued_or_running_work_is_preserved(self):
        for queue in [{}, {'queue_running': [], 'queue_pending': None},
                      {'queue_running': [['active']], 'queue_pending': []},
                      {'queue_running': [], 'queue_pending': [['queued']]}]:
            with self.subTest(queue=queue):
                response = io.StringIO(json.dumps(queue))
                with patch.object(memory.urllib.request, 'urlopen', return_value=response), self.assertRaises(ValueError):
                    memory.require_idle(18189)

    def test_driver_memory_is_verified_without_initializing_cuda(self):
        with patch.object(memory.subprocess, 'check_output', return_value='32623, 4072\n'):
            self.assertEqual(memory.gpu_memory(), {'totalBytes': 32623 * 1024**2, 'freeBytes': 4072 * 1024**2})
        for value in ['N/A, N/A\n', '24000, 26000\n', '24000, 12000\n24000, 12000\n']:
            with self.subTest(value=value), patch.object(memory.subprocess, 'check_output', return_value=value), \
                    self.assertRaises(ValueError):
                memory.gpu_memory()


if __name__ == '__main__':
    unittest.main()
