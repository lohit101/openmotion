"""Explicit setup-only package acceleration. Never imports models or starts compute."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import time

ENVIRONMENT = """
import hashlib,importlib.metadata as m,json,sys
from pathlib import Path
items=[]
for d in m.distributions():
 p=Path(d._path);s=p.stat()
 items.append((d.metadata['Name'],d.version,str(p),s.st_ino,s.st_mtime_ns))
print(hashlib.sha256(json.dumps([sys.prefix,sys.version,sorted(items)]).encode()).hexdigest())
"""


def pinned_arguments(arguments):
    """Use uv only for explicit pins, with no requirements/build/editable semantics."""
    pins = []; index = 0
    while index < len(arguments):
        arg = str(arguments[index])
        if arg in ('--no-cache-dir', '--no-cache'): index += 1; continue
        if arg in ('--index-url',):
            index += 2
            if index > len(arguments): return False
            continue
        if not re.fullmatch(r'[A-Za-z0-9_.-]+==[A-Za-z0-9_.+!-]+', arg): return False
        pins.append(arg); index += 1
    return bool(pins)


def requirement_bytes(arguments):
    """Hash requirements/constraints and included files; refuse incomplete cache keys."""
    result = []; seen = set()
    def visit(file):
        file = Path(file).absolute()
        if file in seen: return
        seen.add(file); content = file.read_bytes(); result.append((str(file), hashlib.sha256(content).hexdigest()))
        for line in content.decode().splitlines():
            # Editable/local source trees can change without a requirements-file
            # change. Let pip inspect them instead of caching that decision.
            if re.search(r'(^|\s)(-e|--editable)(\s|=)|(?:git|hg|svn|bzr)\+|file:|^\s*(?:\.|/)', line):
                raise ValueError('Mutable package source')
            match = re.match(r'^\s*(?:-r|--requirement|-c|--constraint)(?:\s+|=)([^#\s]+)', line)
            if match: visit(file.parent / match.group(1))
            elif re.match(r'^\s*(?:-r|-c)\S', line): visit(file.parent / shlex.split(line)[0][2:])
            elif line.lstrip().startswith('-'): raise ValueError('Requirement options need a normal pip check')
    if any(arg in ('-e','--editable') for arg in arguments): raise ValueError('Editable package')
    for i, arg in enumerate(arguments):
        if arg in ('-r', '--requirement', '-c', '--constraint'): visit(arguments[i + 1])
    return sorted(result)


class SetupInstaller:
    def __init__(self, root):
        self.root = Path(root); self.folder = self.root / 'state/package-installs'
        self.folder.mkdir(parents=True, exist_ok=True)
        self.completed = {}; self.environments = {}

    def uv(self):
        candidates = [self.root / '.bootstrap-tools/bin/uv', self.root.parent / '.bootstrap-tools/bin/uv', shutil.which('uv'), '/venv/main/bin/uv']
        return next((str(p) for p in candidates if p and Path(p).is_file() and os.access(p, os.X_OK)), None)

    def signature(self, python):
        return subprocess.check_output([str(python), '-c', ENVIRONMENT], text=True, timeout=20).strip()

    def run(self, command, **kwargs):
        args = [str(value) for value in command]
        if len(args) < 4 or args[1:4] != ['-m', 'pip', 'install']:
            return subprocess.run(command, **kwargs)
        python = args[0]; env = {**os.environ, **(kwargs.get('env') or {}), 'PIP_DISABLE_PIP_VERSION_CHECK': '1'}
        kwargs = {**kwargs, 'env': env}; start = time.monotonic()
        permitted={'PIP_NO_CACHE_DIR','PIP_DISABLE_PIP_VERSION_CHECK','PIP_INDEX_URL','PIP_DEFAULT_TIMEOUT'}
        custom=any(k.startswith('PIP_') and k not in permitted for k in env) or bool(env.get('REQUESTS_CA_BUNDLE'))
        # A per-environment lock also protects separate setup observers/processes.
        environment = hashlib.sha256(str(Path(python).absolute()).encode()).hexdigest()
        record = self.folder / (environment + '.json')
        with (self.folder / (environment + '.lock')).open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            try:
                configs=[Path.home()/'.config/pip/pip.conf',Path.home()/'.pip/pip.conf',Path('/etc/pip.conf'),Path(python).parent.parent/'pip.conf']
                if custom or any(p.is_file() for p in configs): raise ValueError('Use original configured pip semantics')
                inputs = [args, str(Path(kwargs.get('cwd') or Path.cwd()).absolute()), requirement_bytes(args),
                          [(str(p),hashlib.sha256(p.read_bytes()).hexdigest()) for p in configs if p.is_file()],
                          {k: v for k, v in env.items() if k.startswith(('PIP_', 'UV_', 'SAM2_'))}]
                key = hashlib.sha256(json.dumps(inputs, sort_keys=True).encode()).hexdigest()
                current = self.signature(python)
                saved = json.loads(record.read_text()) if record.is_file() else {}
            except (OSError, ValueError, subprocess.SubprocessError):
                key = current = None; saved = {}
            if key and saved.get('environment') == current and key in saved.get('commands', []):
                print('RECAST_PACKAGE ' + json.dumps({'state': 'reused', 'seconds': round(time.monotonic()-start, 3)}), flush=True)
                if self.environments.get(python) != current: self.completed[python] = set()
                self.environments[python] = current; self.completed.setdefault(python, set()).add(key)
                return subprocess.CompletedProcess(command, 0)
            uv = self.uv() if pinned_arguments(args[4:]) and not custom and not any(p.is_file() for p in configs) else None
            used='pip'
            if uv:
                fast = [uv, 'pip', 'install', '--no-config', '--python', python, *[arg for arg in args[4:] if arg != '--no-cache-dir'], '--no-cache']
                if env.get('PIP_INDEX_URL') and '--index-url' not in args: fast += ['--index-url', env['PIP_INDEX_URL']]
                fast_env = {**{k:v for k,v in env.items() if not k.startswith('UV_')}, 'UV_CONCURRENT_DOWNLOADS': '8', 'UV_CONCURRENT_INSTALLS': str(min(8, os.cpu_count() or 2)), 'UV_CONCURRENT_BUILDS': '1'}
                if env.get('PIP_DEFAULT_TIMEOUT'): fast_env['UV_HTTP_TIMEOUT']=env['PIP_DEFAULT_TIMEOUT']
                try: result = subprocess.run(fast, **{**kwargs, 'env': fast_env, 'check': False})
                except OSError: result = subprocess.CompletedProcess(fast, 1)
                used='uv'
                if result.returncode:
                    print('RECAST_PACKAGE Using the original pip installer for this package set', flush=True)
                    used='pip';result = subprocess.run(command, **kwargs)
            else:
                result = subprocess.run(command, **kwargs)
            if result.returncode == 0 and key:
                try: after = self.signature(python)
                except (OSError, subprocess.SubprocessError): after = None
                if self.environments.get(python) != after: self.completed[python] = set()
                self.environments[python] = after; self.completed.setdefault(python, set()).add(key)
                self._seal(python)
            print('RECAST_PACKAGE ' + json.dumps({'state': 'installed' if result.returncode == 0 else 'failed', 'installer': used, 'seconds': round(time.monotonic()-start, 3)}), flush=True)
            return result

    def seal(self, python):
        """Retain only receipts whose exact installed environment is still unchanged."""
        name=hashlib.sha256(str(Path(python).absolute()).encode()).hexdigest()
        with (self.folder/(name+'.lock')).open('a') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX);self._seal(python)

    def _seal(self, python):
        environment = hashlib.sha256(str(Path(python).absolute()).encode()).hexdigest()
        target = self.folder / (environment + '.json')
        try:
            signature = self.signature(python)
            if signature != self.environments.get(python): return
            old = json.loads(target.read_text()) if target.is_file() else {}
            keys = set(old.get('commands', [])) if old.get('environment') == signature else set()
            keys.update(self.completed.get(python, set()))
            temporary = target.with_suffix('.tmp'); temporary.write_text(json.dumps({'environment': signature, 'commands': sorted(keys)})); temporary.replace(target)
        except (OSError, ValueError, subprocess.SubprocessError):
            pass  # A missing cache only repeats a normal package check.


class SetupCommands:
    """Inject only package execution into a frozen setup implementation."""
    def __init__(self, installer): self.installer = installer
    def __getattr__(self, name): return getattr(subprocess, name)
    def run(self, command, **kwargs): return self.installer.run(command, **kwargs)
