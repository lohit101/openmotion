#!/usr/bin/env python3
"""Configure once, deploy over SSH, then reopen the private ComfyUI in one command."""

import argparse
import hashlib
import json
import os
import re
import shlex
import shutil
import socket
import subprocess
import sys
import tarfile
import tempfile
import webbrowser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LOCAL = ROOT / ".local"
CONFIG = LOCAL / "connection.json"


def parse_ssh(command):
    tokens = shlex.split(command)
    if not tokens or Path(tokens.pop(0)).name != "ssh":
        raise ValueError("Paste the SSH command supplied by Vast, starting with ssh.")
    result = {"port": 22, "user": "root", "identity": ""}
    destination = None
    index = 0
    while index < len(tokens):
        token = tokens[index]
        if token in ("-p", "-i", "-l", "-L"):
            if index + 1 >= len(tokens):
                raise ValueError("Missing value after " + token)
            value = tokens[index + 1]
            if token == "-p":
                result["port"] = int(value)
            elif token == "-i":
                result["identity"] = str(Path(value).expanduser())
            elif token == "-l":
                result["user"] = value
            index += 2
            continue
        if token.startswith("-p") and token[2:].isdigit():
            result["port"] = int(token[2:])
        elif token in ("-t", "-tt", "-T"):
            pass
        elif token.startswith("-"):
            raise ValueError("Unsupported SSH option %s. Use Vast's simple SSH command." % token)
        elif destination is None:
            destination = token
        else:
            raise ValueError("Unexpected text after the SSH destination; remote commands are not accepted.")
        index += 1
    if not destination:
        raise ValueError("The SSH command has no destination.")
    if "@" in destination:
        result["user"], destination = destination.rsplit("@", 1)
    result["host"] = destination.strip("[]")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.:-]*", result["host"]) or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]*", result["user"]):
        raise ValueError("Invalid SSH host or user.")
    if not 1 <= result["port"] <= 65535:
        raise ValueError("Invalid SSH port.")
    if any(c in result["identity"] for c in "\r\n\0"):
        raise ValueError("Invalid identity path.")
    return result


def ssh_arguments(config):
    args = ["ssh", "-p", str(config["port"]), "-o", "StrictHostKeyChecking=accept-new",
            "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=3"]
    if config.get("identity"):
        args += ["-i", config["identity"]]
    if config.get("host_key_alias"):
        args += ["-o", "HostKeyAlias=" + config["host_key_alias"], "-o", "IdentitiesOnly=yes"]
    if os.environ.get("RECAST_SSH_BATCH") == "1":
        args += ["-o", "BatchMode=yes", "-o", "ConnectTimeout=12"]
    return args


def destination(config):
    return config["user"] + "@" + config["host"]


def remote(config, arguments, **kwargs):
    return subprocess.run(ssh_arguments(config) + ["-T", destination(config), shlex.join([str(x) for x in arguments])], check=True, **kwargs)


def load():
    if not CONFIG.exists():
        raise SystemExit("First run: python3 scripts/vast.py configure")
    return json.loads(CONFIG.read_text())


def control_path(config):
    key = "%s:%s:%s:%s" % (ROOT, config["host"], config["port"], config["local_port"])
    if config.get("host_key_alias"):
        key += ":" + config["host_key_alias"]
    suffix = hashlib.sha256(key.encode()).hexdigest()[:12]
    return str(Path(tempfile.gettempdir()) / ("cswap-%s-%s.sock" % (os.getuid(), suffix)))


def master_running(config):
    result = subprocess.run(ssh_arguments(config) + ["-S", control_path(config), "-O", "check", destination(config)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return result.returncode == 0


def close_tunnel(config):
    if master_running(config):
        subprocess.run(ssh_arguments(config) + ["-S", control_path(config), "-O", "exit", destination(config)], check=True)


def tunnel(config, browser=True):
    if not master_running(config):
        with socket.socket() as probe:
            if probe.connect_ex(("127.0.0.1", config["local_port"])) == 0:
                raise SystemExit("Local port %d is occupied. Configure a different --local-port." % config["local_port"])
        forward = "127.0.0.1:%d:127.0.0.1:%d" % (config["local_port"], config["remote_port"])
        subprocess.run(ssh_arguments(config) + ["-M", "-S", control_path(config), "-f", "-N", "-o", "ExitOnForwardFailure=yes", "-L", forward, destination(config)], check=True)
    url = "http://127.0.0.1:%d" % config["local_port"]
    print("ComfyUI: " + url)
    if browser:
        webbrowser.open(url)


def configure(args):
    command = args.ssh_command or input("Paste Vast's SSH command: ").strip()
    config = parse_ssh(command)
    if args.identity:
        config["identity"] = str(args.identity.expanduser().resolve())
    elif not config["identity"] and Path("~/.ssh/comfyui_vast").expanduser().exists():
        config["identity"] = str(Path("~/.ssh/comfyui_vast").expanduser())
    if CONFIG.exists():
        close_tunnel(json.loads(CONFIG.read_text()))
    config.update({"local_port": args.local_port,
                   "remote_port": json.loads((ROOT / "config/server.json").read_text())["port"],
                   "remote_root": "/workspace/character-swap"})
    if getattr(args, "instance_id", None):
        config["instance_id"] = int(args.instance_id)
        config["host_key_alias"] = "recast-instance-%d" % config["instance_id"]
    LOCAL.mkdir(mode=0o700, exist_ok=True)
    CONFIG.write_text(json.dumps(config, indent=2) + "\n")
    CONFIG.chmod(0o600)
    print("Saved connection to %s:%d. No Vast API key is needed." % (config["host"], config["port"]))


def bundle(path):
    with tarfile.open(path, "w:gz") as archive:
        for name in ["README.md", "config", "scripts", "custom_nodes", "workflows", "tests", "validation", "licenses"]:
            source = ROOT / name
            if not source.exists():
                raise RuntimeError("Missing deployment file: " + name)
            files = [source] if source.is_file() else sorted(source.rglob("*"))
            for file in files:
                if file.is_file() and "__pycache__" not in file.parts and file.suffix != ".pyc":
                    archive.add(file, arcname=str(file.relative_to(ROOT)), recursive=False)


def upload_package(config):
    LOCAL.mkdir(exist_ok=True)
    path = LOCAL / "deployment.tar.gz"
    bundle(path)
    root = config["remote_root"]
    command = "mkdir -p %s && tar -xzf - -C %s" % (shlex.quote(root), shlex.quote(root))
    print("Uploading setup files (%.0f KB); model weights are downloaded directly on the GPU host." % (path.stat().st_size / 1024), flush=True)
    with path.open("rb") as stream:
        subprocess.run(ssh_arguments(config) + ["-T", destination(config), command], stdin=stream, check=True)


def setup(config, no_browser=False):
    upload_package(config)
    remote(config, ["bash", config["remote_root"] + "/scripts/bootstrap.sh"])
    tunnel(config, not no_browser)


def key():
    directory = Path("~/.ssh").expanduser()
    directory.mkdir(mode=0o700, exist_ok=True)
    candidates = [directory / "comfyui_vast.pub", directory / "id_ed25519.pub", directory / "id_rsa.pub"]
    existing = next((path for path in candidates if path.exists()), None)
    if existing is None:
        private = directory / "comfyui_vast"
        subprocess.run(["ssh-keygen", "-t", "ed25519", "-f", str(private), "-C", "comfyui-vast"], check=True)
        existing = private.with_suffix(".pub")
    print("Add this PUBLIC key to Vast > Account > SSH Keys before creating the instance:\n")
    print(existing.read_text().strip())
    print("\nPublic key file: " + str(existing))


def pull(config):
    if not shutil.which("rsync"):
        raise SystemExit("Install rsync on your local machine first.")
    base = config["remote_root"]
    for remote_path, local in [(base + "/data/output/", ROOT / "outputs"),
                               (base + "/data/user/default/workflows/", ROOT / "backups/workflows"),
                               (base + "/state/", ROOT / "backups/state")]:
        local.mkdir(parents=True, exist_ok=True)
        subprocess.run(["rsync", "-az", "--partial", "-e", shlex.join(ssh_arguments(config)),
                        destination(config) + ":" + remote_path, str(local) + "/"], check=True)
    print("Downloaded outputs, saved workflows and runtime records. Models were not copied.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    sub.add_parser("key", help="Print an existing public SSH key or create a dedicated one")
    config = sub.add_parser("configure", help="Save the instance's SSH command once")
    config.add_argument("--ssh-command")
    config.add_argument("--identity", type=Path)
    config.add_argument("--local-port", type=int, default=8188)
    config.add_argument("--instance-id", type=int)
    for action in ["setup", "open"]:
        item = sub.add_parser(action)
        item.add_argument("--no-browser", action="store_true")
    for action in ["status", "logs", "doctor", "pull", "close", "stop-server", "shell"]:
        sub.add_parser(action)
    item = sub.add_parser("push-lora")
    item.add_argument("file", type=Path)
    args = parser.parse_args()
    if args.action == "key":
        key()
        return
    if args.action == "configure":
        if not 1 <= args.local_port <= 65535:
            parser.error("local port must be between 1 and 65535")
        configure(args)
        return
    config = load()
    root = config["remote_root"]
    if args.action == "setup":
        setup(config, args.no_browser)
    elif args.action == "open":
        remote(config, ["bash", root + "/scripts/server.sh", "start"])
        tunnel(config, not args.no_browser)
    elif args.action in ["status", "logs", "stop-server"]:
        remote(config, ["bash", root + "/scripts/server.sh", "stop" if args.action == "stop-server" else args.action])
    elif args.action == "doctor":
        remote(config, [root + "/.venv/bin/python", root + "/scripts/doctor.py"])
    elif args.action == "close":
        close_tunnel(config)
        print("SSH tunnel closed. The rented GPU continues billing until stopped in Vast.")
    elif args.action == "pull":
        pull(config)
    elif args.action == "shell":
        subprocess.run(ssh_arguments(config) + [destination(config)], check=True)
    elif args.action == "push-lora":
        source = args.file.expanduser().resolve()
        if not source.is_file() or source.suffix != ".safetensors":
            parser.error("Choose an existing .safetensors LoRA file")
        remote(config, ["mkdir", "-p", root + "/models/loras/user"])
        target = root + "/models/loras/user/" + source.name
        command = "cat > " + shlex.quote(target + ".part") + " && mv " + shlex.quote(target + ".part") + " " + shlex.quote(target)
        with source.open("rb") as stream:
            subprocess.run(ssh_arguments(config) + ["-T", destination(config), command], stdin=stream, check=True)
        print("Uploaded user/%s. Refresh ComfyUI's model list and select it in LoRA A or B." % source.name)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, subprocess.CalledProcessError, OSError) as error:
        raise SystemExit(str(error))
