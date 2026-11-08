#!/usr/bin/env python3
"""Download the selected pinned files, with resume and SHA256 verification."""

import argparse
import concurrent.futures
import fcntl
import hashlib
import json
import os
import re
import shutil
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        if redirected and urllib.parse.urlparse(req.full_url).netloc != urllib.parse.urlparse(newurl).netloc:
            redirected.remove_header("Authorization")
        return redirected


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def atomic_json(path, value):
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def report_transfer(item, downloaded, phase, bytes_per_second=None):
    print('RECAST_MODEL_PROGRESS ' + json.dumps({'destination': item['destination'], 'downloaded': downloaded,
          'total': item['size'], 'phase': phase, 'bytesPerSecond': bytes_per_second}), flush=True)


def valid_file(path, item, rehash=False):
    if not path.is_file() or path.stat().st_size != item["size"]:
        return False
    stamp_path = path.with_name(path.name + ".verified.json")
    stat = path.stat()
    expected = {"sha256": item["sha256"], "size": stat.st_size, "mtime_ns": stat.st_mtime_ns}
    try:
        if not rehash and json.loads(stamp_path.read_text()) == expected:
            return True
    except (OSError, ValueError):
        pass
    if sha256(path) != item["sha256"]:
        return False
    atomic_json(stamp_path, expected)
    return True


def fresh_resolve_url(url):
    """Refresh resolver redirects; content identity still comes from pinned SHA256."""
    parsed = urllib.parse.urlsplit(url)
    github_release = parsed.hostname == 'github.com' and '/releases/download/' in parsed.path
    huggingface_resolve = parsed.hostname == 'huggingface.co' and '/resolve/' in parsed.path
    if not github_release and not huggingface_resolve:
        return url
    query = [(key, value) for key, value in urllib.parse.parse_qsl(parsed.query, keep_blank_values=True) if key != 'recast']
    if huggingface_resolve and not any(key == 'download' for key, _ in query):
        query.append(('download', 'true'))
    query.append(('recast', str(int(time.time()))))
    return urllib.parse.urlunsplit(parsed._replace(query=urllib.parse.urlencode(query)))


def download(item, model_dir, *, opener=None, base_url=None, rehash=False, retries=4, stream_download=None):
    relative = Path(item["destination"])
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError("Unsafe model destination")
    final = model_dir / relative
    final.parent.mkdir(parents=True, exist_ok=True)
    with final.with_name(final.name + ".lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if valid_file(final, item, rehash):
            report_transfer(item, item['size'], 'ready')
            print("Ready: " + relative.as_posix(), flush=True)
            return final
        part = final.with_name(final.name + ".part")
        if part.exists() and part.stat().st_size > item["size"]:
            part.unlink()
        quoted = urllib.parse.quote(item["filename"], safe="/")
        url = base_url or item.get("url") or "https://huggingface.co/%s/resolve/%s/%s?download=true" % (item["repo"], item["revision"], quoted)
        url = fresh_resolve_url(url)
        opener = opener or urllib.request.build_opener(SafeRedirect())
        # Managed workers supply Xet explicitly. Standalone/historical facial
        # packages keep this dependency-free HTTP path and the same file locks.
        for attempt in range(retries):
            try:
                offset = part.stat().st_size if part.exists() else 0
                used_stream = stream_download is not None and offset < item['size'] and stream_download(item, part, report_transfer)
                if offset < item["size"] and not used_stream:
                    headers = {"User-Agent": "character-swap-setup/1", "Accept-Encoding": "identity"}
                    token = os.environ.get("HF_TOKEN", "")
                    if token and urllib.parse.urlparse(url).hostname == "huggingface.co":
                        headers["Authorization"] = "Bearer " + token
                    if offset:
                        headers["Range"] = "bytes=%d-" % offset
                    request = urllib.request.Request(url, headers=headers)
                    with opener.open(request, timeout=90) as response:
                        if response.status == 206:
                            match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)", response.headers.get("Content-Range", ""))
                            if not match or int(match[1]) != offset or int(match[3]) != item["size"]:
                                raise ValueError("Server returned the wrong byte range")
                            mode = "ab"
                        elif response.status == 200:
                            offset, mode = 0, "wb"
                        else:
                            raise ValueError("Unexpected download status %s" % response.status)
                        content_type = response.headers.get("Content-Type", "").lower()
                        if "text/html" in content_type:
                            raise ValueError("Received an HTML page instead of model data")
                        last_report = started = time.monotonic()
                        initial_offset = offset
                        count = offset
                        print("Downloading %s (%.2f / %.2f GB)" % (final.name, count / 1e9, item["size"] / 1e9), flush=True)
                        report_transfer(item, count, 'downloading')
                        with part.open(mode) as output:
                            for block in iter(lambda: response.read(512 * 1024), b""):
                                output.write(block)
                                count += len(block)
                                if count > item["size"]:
                                    raise ValueError("Download exceeded the pinned file size")
                                if time.monotonic() - last_report > 1:
                                    speed = (count - initial_offset) / max(0.001, time.monotonic() - started)
                                    report_transfer(item, count, 'downloading', speed)
                                    print("  %s: %.0f%%" % (final.name, 100 * count / item["size"]), flush=True)
                                    last_report = time.monotonic()
                if part.stat().st_size != item["size"]:
                    raise OSError("Incomplete download; partial file retained for resume")
                report_transfer(item, item['size'], 'verifying')
                if sha256(part) != item["sha256"]:
                    part.unlink()
                    raise ValueError("SHA256 mismatch; invalid partial file removed")
                part.replace(final)
                stat = final.stat()
                atomic_json(final.with_name(final.name + ".verified.json"),
                            {"sha256": item["sha256"], "size": stat.st_size, "mtime_ns": stat.st_mtime_ns})
                print("Verified: " + final.name, flush=True)
                report_transfer(item, item['size'], 'ready')
                return final
            except urllib.error.HTTPError as error:
                if error.code in (401, 403, 404):
                    raise RuntimeError("Model access failed (HTTP %d): %s. Check the pinned source and access rights." % (error.code, final.name)) from error
                if attempt + 1 == retries:
                    raise
            except (OSError, ValueError) as error:
                if attempt + 1 == retries:
                    raise RuntimeError("Download failed for %s: %s" % (final.name, error)) from error
            time.sleep(min(2 ** attempt, 8))
        raise RuntimeError("Download retry limit reached")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", type=Path, default=ROOT / "models")
    parser.add_argument("--manifest", type=Path, default=ROOT / "config/models.lock.json")
    parser.add_argument("--workers", type=int, choices=range(1, 5), default=4)
    parser.add_argument("--reserve-gb", type=int, choices=range(5, 65), default=5)
    parser.add_argument("--verify-only", action="store_true")
    parser.add_argument("--rehash", action="store_true")
    parser.add_argument("--list", action="store_true")
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text())
    if args.list:
        for item in manifest["files"]:
            print("%6.2f GB  %s" % (item["size"] / 1e9, item["destination"]))
        print("Total: %.2f GB" % (manifest["total_bytes"] / 1e9))
        return
    args.model_dir.mkdir(parents=True, exist_ok=True)
    missing = [f for f in manifest["files"] if not valid_file(args.model_dir / f["destination"], f, args.rehash)]
    if args.verify_only:
        if missing:
            raise SystemExit("Missing or invalid models: " + ", ".join(f["destination"] for f in missing))
        print("All %d model files verified." % len(manifest["files"]))
        return
    pending = sum(max(0, f["size"] - min(f["size"], (args.model_dir / (f["destination"] + ".part")).stat().st_size))
                  if (args.model_dir / (f["destination"] + ".part")).exists() else f["size"] for f in missing)
    reserve = args.reserve_gb * 1024 ** 3
    if shutil.disk_usage(args.model_dir).free < pending + reserve:
        raise SystemExit("Need %.1f GB free for remaining downloads plus working space." % ((pending + reserve) / 1e9))
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(download, item, args.model_dir, rehash=args.rehash) for item in manifest["files"]]
        for future in futures:
            future.result()


if __name__ == "__main__":
    main()
