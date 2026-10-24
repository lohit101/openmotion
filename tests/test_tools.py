"""Offline tests for failure modes that could waste rental time or break continuity."""

import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
import unittest
from unittest.mock import patch, Mock
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import download_models
import vast
import render_clip
spec_server = importlib.util.spec_from_file_location('swap_server', ROOT / 'scripts/server.py')
swap_server = importlib.util.module_from_spec(spec_server)
spec_server.loader.exec_module(swap_server)
from check_workflows import check_api, check_ui

spec = importlib.util.spec_from_file_location("swap_rules", ROOT / "custom_nodes/character_swap_helpers/logic.py")
rules = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rules)


class ContinuityTests(unittest.TestCase):
    def test_thirty_seconds_have_no_gaps_or_duplicated_frames(self):
        completed, windows = 0, []
        while completed < 480:
            plan = rules.next_segment(completed, 480)
            self.assertEqual(plan["skip_frames"] + plan["overlap"], completed)
            new = plan["frame_cap"] - plan["overlap"]
            self.assertGreater(new, 0)
            windows.append(plan)
            completed += new
        self.assertEqual(completed, 480)
        self.assertEqual(len(windows), 7)
        self.assertEqual(windows[-1], {"skip_frames": 456, "frame_cap": 24, "overlap": 5})
        self.assertEqual(rules.padded_length(24), 25)

    def test_short_tails_and_multiple_valid_lengths(self):
        for target in [5, 6, 49, 81, 82, 83, 157, 158, 480, 481, 960]:
            completed = 0
            while completed < target:
                plan = rules.next_segment(completed, target)
                self.assertLessEqual(plan["frame_cap"], 81)
                self.assertGreaterEqual(plan["frame_cap"], 5)
                completed += plan["frame_cap"] - plan["overlap"]
            self.assertEqual(completed, target)

    def test_context_rejects_wrong_offset_and_geometry(self):
        metadata = {"width": "480", "height": "832", "count": "5", "fps": "16", "source_end_frame": "81"}
        rules.context_matches(metadata, 480, 832, 16, 76)
        for settings in [(480, 832, 16, 81), (832, 480, 16, 76), (480, 832, 24, 76)]:
            with self.assertRaises(ValueError):
                rules.context_matches(metadata, *settings)


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg is required")
class VideoAssemblyTests(unittest.TestCase):
    def test_aac_segment_preroll_does_not_shift_video_or_accumulate_gaps(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source.mp4"
            subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                            "-f", "lavfi", "-i", "testsrc2=size=64x96:rate=16:duration=2",
                            "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2",
                            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(source)], check=True)
            for index in range(2):
                subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", str(index),
                                "-i", str(source), "-t", "1", "-c:v", "libx264", "-c:a", "aac",
                                str(root / ("segment_%04d.mp4" % index))], check=True)
            state = {"segments": [{}, {}], "completed_frames": 32,
                     "settings": {"fps": 16, "start_seconds": 0}, "source": str(source)}
            render_clip.finish_video(state, root)
            probe = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-count_frames",
                "-show_entries", "stream=codec_type,start_time,duration,nb_read_frames", "-show_entries",
                "format=duration", "-of", "json", str(root / "final.mp4")], text=True))
            video = next(stream for stream in probe["streams"] if stream["codec_type"] == "video")
            self.assertEqual(int(video["nb_read_frames"]), 32)
            self.assertAlmostEqual(float(video["start_time"]), 0, places=3)
            self.assertAlmostEqual(float(probe["format"]["duration"]), 2, places=3)
            for stream in probe["streams"]:
                self.assertAlmostEqual(float(stream["start_time"]), 0, places=3)


class SSHTests(unittest.TestCase):
    def test_pasted_vast_command_is_parsed_without_evaluation(self):
        value = vast.parse_ssh('ssh -p 23456 root@ssh4.vast.ai -L 8080:localhost:8080 -i "/tmp/key with spaces"')
        self.assertEqual(value, {"port": 23456, "user": "root", "identity": "/tmp/key with spaces", "host": "ssh4.vast.ai"})

    def test_remote_commands_and_shell_fragments_are_rejected(self):
        for value in ['ssh root@host.example touch /tmp/unwanted', 'ssh root@host.example;touch /tmp/unwanted',
                      'ssh -o ProxyCommand=unwanted root@host.example', 'ssh -p 70000 root@host.example',
                      'sh -c unwanted', 'ssh root@host.example && unwanted']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                vast.parse_ssh(value)

    def test_deployment_excludes_models_credentials_and_research(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "deployment.tar.gz"
            vast.bundle(path)
            with tarfile.open(path) as archive:
                names = archive.getnames()
            self.assertIn("workflows/scail2_int8_swap.json", names)
            self.assertIn("scripts/bootstrap.sh", names)
            self.assertFalse(any(name.startswith((".local/", "models/", "research/", "outputs/")) for name in names))


class ServerLifecycleTests(unittest.TestCase):
    def test_missing_pid_file_recovers_only_the_exact_private_comfy_process(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); proc = root / 'proc'; state = root / 'state'; state.mkdir(); proc.mkdir()
            main = '/workspace/ComfyUI-character-swap/main.py'
            for pid, port, inputs in [(101, '18189', str(root/'data/input')), (102, '8188', str(root/'data/input')), (103, '18189', '/another/input')]:
                folder = proc/str(pid); folder.mkdir(); (folder/'cmdline').write_bytes('\0'.join(['python', main, '--port', port, '--input-directory', inputs]).encode())
            with patch.multiple(swap_server, ROOT=root, STATE=state, PIDFILE=state/'server.json', PROC=proc), patch.object(swap_server, 'configuration', return_value=({'comfy_root':'/workspace/ComfyUI-character-swap'}, {'port':18189})), patch.object(swap_server.os, 'kill'):
                saved=swap_server.running(); self.assertEqual(saved['pid'],101); self.assertTrue(saved['recovered'])
                self.assertEqual(json.loads((state/'server.json').read_text())['pid'],101)

    def test_owned_process_stop_signals_its_isolated_group_but_not_a_shared_shell_group(self):
        with patch.object(swap_server.os, 'getpgid', return_value=101), patch.object(swap_server.os, 'killpg') as group, patch.object(swap_server.os, 'kill') as single:
            swap_server.signal_owned({'pid':101}, 2); group.assert_called_once_with(101,2); single.assert_not_called()
        with patch.object(swap_server.os, 'getpgid', return_value=99), patch.object(swap_server.os, 'killpg') as group, patch.object(swap_server.os, 'kill') as single:
            swap_server.signal_owned({'pid':101}, 2); single.assert_called_once_with(101,2); group.assert_not_called()

    def test_slow_comfy_startup_warns_and_keeps_waiting_without_time_failure(self):
        process=Mock(); process.poll.return_value=None
        with patch.object(swap_server, 'ready', side_effect=[False]*121+[True]), patch.object(swap_server.time, 'sleep'), patch('builtins.print') as output:
            swap_server.wait_ready({'port':18189}, process=process)
            self.assertTrue(any('RECAST_WARNING' in str(call) for call in output.call_args_list))


DATA = b"model-download-fixture\x00" * 8192


class DownloadHandler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        body = DATA if self.path != "/corrupt" else b"x" * len(DATA)
        offset = 0
        if self.headers.get("Range") and self.path != "/ignore-range":
            offset = int(self.headers["Range"].removeprefix("bytes=").removesuffix("-"))
            self.send_response(206)
            returned_offset = offset + 1 if self.path == "/wrong-range" else offset
            self.send_header("Content-Range", "bytes %d-%d/%d" % (returned_offset, len(body) - 1, len(body)))
        else:
            self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(body) - offset))
        self.end_headers()
        self.wfile.write(body[offset:])


class DownloadTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), DownloadHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = "http://127.0.0.1:%d" % cls.server.server_port

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def item(self):
        return {"destination": "diffusion_models/test.safetensors", "size": len(DATA),
                "sha256": hashlib.sha256(DATA).hexdigest(), "repo": "test/test", "revision": "pinned", "filename": "test.safetensors"}

    def test_resume_and_ignored_range_both_produce_the_correct_file(self):
        for route in ["/resume", "/ignore-range"]:
            with self.subTest(route=route), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                partial = root / "diffusion_models/test.safetensors.part"
                partial.parent.mkdir()
                partial.write_bytes(DATA[:13107])
                final = download_models.download(self.item(), root, base_url=self.url + route, retries=1)
                self.assertEqual(final.read_bytes(), DATA)
                self.assertTrue(download_models.valid_file(final, self.item()))
                self.assertFalse(partial.exists())

    def test_corrupt_download_is_not_promoted(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with self.assertRaises(RuntimeError):
                download_models.download(self.item(), root, base_url=self.url + "/corrupt", retries=1)
            self.assertFalse((root / self.item()["destination"]).exists())

    def test_wrong_resume_offset_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            partial = root / "diffusion_models/test.safetensors.part"
            partial.parent.mkdir()
            partial.write_bytes(DATA[:100])
            with self.assertRaises(RuntimeError):
                download_models.download(self.item(), root, base_url=self.url + "/wrong-range", retries=1)
            self.assertEqual(partial.stat().st_size, 100)

    def test_existing_file_without_a_stamp_is_hashed(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "test"
            path.write_bytes(DATA)
            self.assertTrue(download_models.valid_file(path, self.item()))
            path.write_bytes(b"z" * len(DATA))
            self.assertFalse(download_models.valid_file(path, self.item(), rehash=True))


class GraphTests(unittest.TestCase):
    def test_layout_nodes_do_not_overlap_in_the_same_column(self):
        for path in (ROOT / "workflows").glob("*.json"):
            graph = json.loads(path.read_text())
            columns = {}
            for node in graph["nodes"]:
                columns.setdefault(node["pos"][0], []).append(node)
            for members in columns.values():
                ordered = sorted(members, key=lambda node: node["pos"][1])
                for previous, current in zip(ordered, ordered[1:]):
                    self.assertLessEqual(previous["pos"][1] + previous["size"][1], current["pos"][1])

    def test_ui_and_api_graphs_match_the_pinned_catalog(self):
        catalog = json.loads((ROOT / "config/node-schema.json").read_text())
        for path in (ROOT / "workflows/api").glob("*.json"):
            with self.subTest(workflow=path.name):
                self.assertEqual(check_api(json.loads(path.read_text()), catalog, True), [])
                self.assertEqual(check_ui(json.loads((ROOT / "workflows" / path.name).read_text())), [])

    def test_scheduler_and_sampler_share_the_same_model(self):
        graph = json.loads((ROOT / "workflows/api/scail2_int8_swap.json").read_text())
        self.assertEqual(graph["42"]["inputs"]["model"], graph["43"]["inputs"]["model"])
        self.assertEqual(graph["24"]["inputs"]["strength_model"], ["1", 7])
        self.assertEqual(graph["42"]["inputs"]["steps"], ["1", 5])
        self.assertEqual(graph["43"]["inputs"]["cfg"], ["1", 6])


if __name__ == "__main__":
    unittest.main()
