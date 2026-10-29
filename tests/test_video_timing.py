"""Regress the paid 124+2-frame join and its falsely unconfirmed face worker."""
from contextlib import redirect_stdout
from copy import deepcopy
from io import StringIO
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from video_timing import decoded_video_info
import facial_worker
import managed_facial_consistency as managed
import video_identity


def fixture(rate='189/8'):
    return {'streams': [{'width': 480, 'height': 864, 'avg_frame_rate': rate}],
            'frames': [{'best_effort_timestamp_time': f'{index / 24:.6f}'} for index in range(126)]}


class VideoTimingTests(unittest.TestCase):
    def test_frozen_24_fps_accepts_actual_cfr_despite_wrong_short_join_average(self):
        data = fixture()
        expected = {'width': 480, 'height': 864, 'frames': 126, 'fps': '24'}
        self.assertEqual(decoded_video_info(data, expected_fps=24), expected)
        # Unknown generic inputs must not silently acquire a guessed frame rate.
        with self.assertRaisesRegex(ValueError, 'Variable frame timing'):
            decoded_video_info(data)
        with patch.object(video_identity.subprocess, 'check_output', return_value=json.dumps(data)):
            self.assertEqual(video_identity.video_info('immutable.mp4', expected_fps=24), expected)
            self.assertEqual(facial_worker.video_info('immutable.mp4'), expected)

    def test_expected_rate_never_accepts_missing_duplicated_or_variable_frames(self):
        base = fixture('24/1')
        missing = deepcopy(base); del missing['frames'][60]
        duplicate = deepcopy(base); duplicate['frames'][60] = duplicate['frames'][59]
        variable = deepcopy(base); variable['frames'][60]['best_effort_timestamp_time'] = '2.510000'
        for data in [missing, duplicate, variable]:
            with self.subTest(data=data['frames'][60]):
                with self.assertRaisesRegex(ValueError, 'Variable frame timing'):
                    decoded_video_info(data, expected_fps=24)

    def test_invalid_or_absent_timestamps_are_not_replaced_by_header_metadata(self):
        for bad in [[], [{}], [{'best_effort_timestamp_time': 'NaN'}]]:
            data = fixture(); data['frames'] = bad
            with self.assertRaisesRegex(ValueError, 'timestamps are missing or invalid'):
                decoded_video_info(data, expected_fps=24)

    def test_local_rejection_clears_remote_active_only_after_confirmed_worker_stop(self):
        for state, stopped in [({'running': False}, True), ({'running': True}, False), ({}, False)]:
            output = StringIO()
            with patch.object(managed, 'video_info', side_effect=ValueError('Variable frame timing')), patch.object(managed, 'call', return_value=state) as poll, redirect_stdout(output):
                with self.assertRaisesRegex(ValueError, 'Variable frame timing'):
                    managed.facial_input_info({}, 'saved-job', 'target.mp4', 'source.mp4')
            poll.assert_called_once_with({}, 'poll', 'saved-job')
            self.assertEqual('RECAST_FACIAL_STOPPED' in output.getvalue(), stopped)
        output = StringIO()
        with patch.object(managed, 'video_info', side_effect=ValueError('Variable frame timing')), patch.object(managed, 'call', side_effect=OSError('SSH unavailable')), redirect_stdout(output):
            with self.assertRaisesRegex(ValueError, 'Variable frame timing'):
                managed.facial_input_info({}, 'saved-job', 'target.mp4', 'source.mp4')
        self.assertNotIn('RECAST_FACIAL_STOPPED', output.getvalue())


if __name__ == '__main__':
    unittest.main()
