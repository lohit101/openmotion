#!/usr/bin/env python3
"""Inventory LoRAs and remove optional files from the managed model directory."""
import argparse
import fcntl
import json
import os
from pathlib import Path, PurePosixPath
import stat



def lora_parts(name):
    if not isinstance(name, str) or not name or len(name) > 300 or any(ord(c) < 32 or ord(c) == 127 for c in name) or '\\' in name:
        raise ValueError('Invalid LoRA filename.')
    parts = name.split('/')
    if PurePosixPath(name).is_absolute() or any(p in ('', '.', '..') for p in parts) or not name.endswith('.safetensors'):
        raise ValueError('Choose a relative .safetensors LoRA filename.')
    return parts


def inventory(model_dir):
    if Path(model_dir).is_symlink():
        raise ValueError('The model directory must not be a symlink.')
    root = Path(model_dir) / 'loras'
    if root.is_symlink():
        raise ValueError('The LoRA directory must not be a symlink.')
    files = {}
    if root.is_dir():
        for folder, directories, names in os.walk(root, followlinks=False):
            directories[:] = [name for name in directories if not (Path(folder) / name).is_symlink()]
            for name in names:
                path = Path(folder) / name
                if path.is_symlink() or not path.is_file() or not name.endswith(('.safetensors', '.safetensors.part')):
                    continue
                relative = path.relative_to(root).as_posix()
                partial = relative.endswith('.part')
                if partial:
                    relative = relative[:-5]
                entry = files.setdefault(relative, {'name': relative, 'size': 0, 'partialSize': 0, 'included': False})
                entry['partialSize' if partial else 'size'] = path.stat().st_size
    return {'loras': sorted(files.values(), key=lambda f: f['name'])}


def remove_lora(model_dir, name):
    parts = lora_parts(name)
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    base = os.open(Path(model_dir), flags)
    try:
        directory = os.open('loras', flags, dir_fd=base)
    finally:
        os.close(base)
    try:
        for part in parts[:-1]:
            child = os.open(part, flags, dir_fd=directory)
            os.close(directory)
            directory = child
        lock = os.open(parts[-1] + '.lock', os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600, dir_fd=directory)
        try:
            if not stat.S_ISREG(os.fstat(lock).st_mode):
                raise ValueError('The model lock must be a regular file.')
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise ValueError('This LoRA is downloading. Finish or cancel that transfer before removing it.')
            targets = []
            for suffix in ('', '.part', '.verified.json'):
                filename = parts[-1] + suffix
                try:
                    info = os.stat(filename, dir_fd=directory, follow_symlinks=False)
                except FileNotFoundError:
                    continue
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                    raise ValueError('Refusing to remove a linked or non-regular model file.')
                targets.append((filename, info.st_size))
            for filename, _size in targets:
                os.unlink(filename, dir_fd=directory)
            return {'name': name, 'freedBytes': sum(size for _filename, size in targets), 'removed': bool(targets)}
        finally:
            os.close(lock)
    finally:
        os.close(directory)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model-dir', required=True, type=Path)
    parser.add_argument('--delete-lora')
    args = parser.parse_args()
    result = remove_lora(args.model_dir, args.delete_lora) if args.delete_lora is not None else inventory(args.model_dir)
    print('RECAST_MODEL_STORAGE ' + json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
