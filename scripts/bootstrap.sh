#!/usr/bin/env bash
set -euo pipefail
SWAP_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
COMFY_ROOT="${COMFY_ROOT:-/workspace/ComfyUI-character-swap}"
export PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
export RECAST_SKIP_MODEL_DOWNLOADS="${RECAST_SKIP_MODEL_DOWNLOADS:-1}"
export RECAST_MODEL_MANIFEST="${RECAST_MODEL_MANIFEST:-$SWAP_ROOT/config/models.lock.json}"
if ! command -v python3 >/dev/null || ! command -v flock >/dev/null; then
  if [[ "$(id -u)" == "0" ]] && command -v apt-get >/dev/null; then
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3 python3-pip util-linux
  else
    echo "Use a root SSH Ubuntu template with Python 3 and flock available." >&2
    exit 1
  fi
fi
mkdir -p "$SWAP_ROOT/state" "$SWAP_ROOT/data/input" "$SWAP_ROOT/data/output" "$SWAP_ROOT/data/temp" "$SWAP_ROOT/data/user/default/workflows/Character Swap" "$SWAP_ROOT/models"
exec 9>"$SWAP_ROOT/state/setup.lock"
if ! flock -n 9; then
  echo "Setup is already running. Reconnect and inspect state/setup.log." >&2
  exit 1
fi
exec > >(tee -a "$SWAP_ROOT/state/setup.log") 2>&1
echo "Checking GPU, RAM, disk and driver before installing."
python3 - "$SWAP_ROOT" <<'PY'
import csv,json,os,shutil,subprocess,sys
from pathlib import Path
root=Path(sys.argv[1]); lock=json.loads((root/'config/runtime.lock.json').read_text())
sys.path.insert(0,str(root/'scripts'))
from resources import effective_ram_bytes,gpu_memory_mib
try:
    rows=list(csv.reader(subprocess.check_output(['nvidia-smi','--query-gpu=name,memory.total,driver_version','--format=csv,noheader,nounits'],text=True).splitlines()))
except (OSError,subprocess.CalledProcessError):
    raise SystemExit('An NVIDIA GPU must be visible inside the container. Run this setup on your Vast instance.')
name,memory,driver=[x.strip() for x in rows[0]]
if tuple(map(int,driver.split('.'))) < tuple(map(int,lock['minimum_driver'].split('.'))):
    raise SystemExit('This CUDA 13 INT8 setup requires driver '+lock['minimum_driver']+' or newer; choose a compatible host.')
ram=effective_ram_bytes()
memory=gpu_memory_mib(name,memory,ram)
if memory<23000: raise SystemExit('This package targets a 24 GB or larger GPU.')
if ram<29*1024**3: raise SystemExit('Choose at least 32 GB system RAM for this native INT8 package.')
manifest=json.loads(Path(os.environ['RECAST_MODEL_MANIFEST']).read_text()); pending=0
for f in ([] if os.environ.get('RECAST_SKIP_MODEL_DOWNLOADS') == '1' else manifest['files']):
    target=root/'models'/f['destination']; partial=target.with_name(target.name+'.part')
    if not target.is_file() or target.stat().st_size!=f['size']:
        pending+=max(0,f['size']-(partial.stat().st_size if partial.exists() else 0))
need=pending+5*1024**3+(0 if (root/'state/packages-ready.json').exists() else 12*1024**3)
free=shutil.disk_usage(root).free
if free<need:raise SystemExit('Need approximately %.1f GB free for this installation; %.1f GB available.'%(need/1e9,free/1e9))
import re
if re.fullmatch(r'(?:NVIDIA\s+)?GB(?:10|200|300)',name,re.I):
    import platform
    if platform.machine().lower() not in ('aarch64','arm64'):raise SystemExit('Grace Blackwell requires a native ARM64 container.')
if 'GB10' in name.upper():
    if ram < 60*10**9:raise SystemExit('Choose a 64 GB-class or larger shared-memory allocation for DGX Spark.')
    print('%s, %.1f GB shared memory, driver %s, %.1f GB free'%(name,memory/1024,driver,free/1e9))
else:
    print('%s, %.1f GB VRAM, %.1f GB RAM, driver %s, %.1f GB free'%(name,memory/1024,ram/1e9,driver,free/1e9))
PY

if [[ "$(id -u)" == "0" ]] && command -v apt-get >/dev/null; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git ffmpeg rsync python3-pip python3-venv libgl1 libglib2.0-0
fi
for SWAP_TOOL in git ffmpeg rsync; do
  command -v "$SWAP_TOOL" >/dev/null || { echo "Missing $SWAP_TOOL; use a root SSH Ubuntu CUDA/PyTorch template." >&2; exit 1; }
done

SWAP_PYTHON=""
for SWAP_CANDIDATE in python3.12 python3.13 python3; do
  if command -v "$SWAP_CANDIDATE" >/dev/null && "$SWAP_CANDIDATE" -c 'import sys;sys.exit(sys.version_info[:2] not in [(3,12),(3,13)])'; then
    SWAP_PYTHON="$(command -v "$SWAP_CANDIDATE")"
    break
  fi
done
if [[ -z "$SWAP_PYTHON" ]]; then
  echo "Installing an isolated Python 3.12 runtime."
  python3 -m pip install --no-cache-dir --target "$SWAP_ROOT/.bootstrap-tools" uv==0.9.13
  export PYTHONPATH="$SWAP_ROOT/.bootstrap-tools${PYTHONPATH:+:$PYTHONPATH}"
  export UV_PYTHON_INSTALL_DIR="$SWAP_ROOT/.python"
  python3 -m uv python install 3.12
  SWAP_PYTHON="$(python3 -m uv python find 3.12)"
fi

cfg() { "$SWAP_PYTHON" -c 'import json,sys;print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$SWAP_ROOT/config/runtime.lock.json" "$1"; }
checkout() {
  local SWAP_REPOSITORY="$1" SWAP_DIRECTORY="$2" SWAP_REVISION="$3"
  if [[ ! -d "$SWAP_DIRECTORY/.git" ]]; then
    if [[ -e "$SWAP_DIRECTORY" ]]; then
      echo "Refusing to overwrite a non-git directory: $SWAP_DIRECTORY" >&2; exit 1
    fi
    git init -q "$SWAP_DIRECTORY"
    git -C "$SWAP_DIRECTORY" remote add origin "$SWAP_REPOSITORY"
  fi
  if [[ "$(git -C "$SWAP_DIRECTORY" remote get-url origin)" != "$SWAP_REPOSITORY" ]]; then
    echo "Unexpected repository at $SWAP_DIRECTORY" >&2; exit 1
  fi
  git -C "$SWAP_DIRECTORY" fetch -q --depth=1 origin "$SWAP_REVISION"
  git -C "$SWAP_DIRECTORY" checkout -q --detach "$SWAP_REVISION"
}
checkout "$(cfg comfyui_repo)" "$COMFY_ROOT" "$(cfg comfyui_commit)"
checkout "$(cfg video_helper_repo)" "$COMFY_ROOT/custom_nodes/ComfyUI-VideoHelperSuite" "$(cfg video_helper_commit)"
"$SWAP_PYTHON" "$SWAP_ROOT/scripts/patch_runtime.py" "$COMFY_ROOT" --state-dir "$SWAP_ROOT/state"
if [[ ! -x "$SWAP_ROOT/.venv/bin/python" ]]; then
  "$SWAP_PYTHON" -m venv "$SWAP_ROOT/.venv"
fi
SWAP_VENV_PYTHON="$SWAP_ROOT/.venv/bin/python"
SWAP_PACKAGE_KEY="$("$SWAP_PYTHON" -c 'import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$SWAP_ROOT/config/runtime.lock.json")"
if [[ ! -f "$SWAP_ROOT/state/packages-ready.json" ]] || ! "$SWAP_VENV_PYTHON" - "$SWAP_ROOT/state/packages-ready.json" "$SWAP_PACKAGE_KEY" <<'PY'
import json,sys
sys.exit(json.load(open(sys.argv[1])).get('key')!=sys.argv[2])
PY
then
  "$SWAP_VENV_PYTHON" -m pip install --upgrade pip
  "$SWAP_VENV_PYTHON" -m pip install "torch==$(cfg torch)" "torchvision==$(cfg torchvision)" "torchaudio==$(cfg torchaudio)" --index-url "$(cfg torch_index)"
  printf 'torch==%s\ntorchvision==%s\ntorchaudio==%s\n' "$(cfg torch)" "$(cfg torchvision)" "$(cfg torchaudio)" > "$SWAP_ROOT/state/torch-constraints.txt"
  mkdir -p "$SWAP_ROOT/state/wheels"
  SWAP_UV="$(command -v uv || true)"
  if [[ -z "$SWAP_UV" && -x /venv/main/bin/uv ]]; then SWAP_UV=/venv/main/bin/uv; fi
  if [[ -n "$SWAP_UV" ]]; then
    "$SWAP_UV" pip install --no-cache --python "$SWAP_VENV_PYTHON" --find-links "$SWAP_ROOT/state/wheels" -r "$COMFY_ROOT/requirements.txt" -r "$COMFY_ROOT/custom_nodes/ComfyUI-VideoHelperSuite/requirements.txt" -c "$SWAP_ROOT/state/torch-constraints.txt"
  else
    "$SWAP_VENV_PYTHON" -m pip install --find-links "$SWAP_ROOT/state/wheels" -r "$COMFY_ROOT/requirements.txt" -r "$COMFY_ROOT/custom_nodes/ComfyUI-VideoHelperSuite/requirements.txt" -c "$SWAP_ROOT/state/torch-constraints.txt"
  fi
  "$SWAP_VENV_PYTHON" - "$SWAP_ROOT/state/packages-ready.json" "$SWAP_PACKAGE_KEY" <<'PY'
import json,sys
from pathlib import Path
Path(sys.argv[1]).write_text(json.dumps({'key':sys.argv[2]}))
PY
  "$SWAP_VENV_PYTHON" -m pip freeze > "$SWAP_ROOT/state/installed-packages.txt"
  rm -f "$SWAP_ROOT/state/wheels/"*.whl
fi

mkdir -p "$COMFY_ROOT/custom_nodes/character_swap_helpers"
rsync -a --delete --exclude '__pycache__' "$SWAP_ROOT/custom_nodes/character_swap_helpers/" "$COMFY_ROOT/custom_nodes/character_swap_helpers/"
"$SWAP_VENV_PYTHON" - "$SWAP_ROOT" "$COMFY_ROOT" <<'PY'
import json,sys
from pathlib import Path
root=Path(sys.argv[1]); comfy=Path(sys.argv[2])
(root/'state/install.json').write_text(json.dumps({'comfy_root':str(comfy),'swap_root':str(root)},indent=2))
keys=['checkpoints','diffusion_models','text_encoders','clip_vision','vae','loras']
lines=['character_swap:','  base_path: '+json.dumps(str(root/'models')),'  is_default: true']
lines += ['  '+key+': '+key for key in keys]
(root/'state/model-paths.yaml').write_text('\n'.join(lines)+'\n')
PY
echo "Checking CUDA kernels before model downloads."
"$SWAP_VENV_PYTHON" - <<'PY'
import torch
if not torch.cuda.is_available():raise SystemExit('PyTorch cannot access the GPU.')
if torch.version.cuda is None or not torch.version.cuda.startswith('13.'):raise SystemExit('Expected a CUDA 13 PyTorch wheel.')
x=torch.randn((64,64),device='cuda',dtype=torch.float16)
torch.mm(x,x);torch.cuda.synchronize()
print('CUDA test passed:',torch.__version__,torch.cuda.get_device_name(0))
PY
if [[ "${RECAST_SKIP_MODEL_DOWNLOADS:-0}" != "1" ]]; then
  "$SWAP_VENV_PYTHON" "$SWAP_ROOT/scripts/download_models.py" --manifest "$RECAST_MODEL_MANIFEST" --model-dir "$SWAP_ROOT/models"
else
  echo 'RECAST_STAGE Runtime installed. Choose model downloads explicitly in Studio.'
fi
if [[ ! -f "$SWAP_ROOT/data/user/default/workflows/Character Swap/02 Character Swap INT8.json" ]]; then
  cp "$SWAP_ROOT/workflows/scail2_int8_swap.json" "$SWAP_ROOT/data/user/default/workflows/Character Swap/02 Character Swap INT8.json"
fi
if [[ ! -f "$SWAP_ROOT/data/user/default/workflows/Character Swap/01 Check Masks.json" ]]; then
  cp "$SWAP_ROOT/workflows/scail2_int8_masks.json" "$SWAP_ROOT/data/user/default/workflows/Character Swap/01 Check Masks.json"
fi
"$SWAP_VENV_PYTHON" "$SWAP_ROOT/scripts/sample_inputs.py" --input-dir "$SWAP_ROOT/data/input"
bash "$SWAP_ROOT/scripts/server.sh" start
if [[ "${RECAST_SKIP_MODEL_DOWNLOADS:-0}" == "1" ]]; then
  "$SWAP_VENV_PYTHON" "$SWAP_ROOT/scripts/doctor.py" --runtime-only
else
  "$SWAP_VENV_PYTHON" "$SWAP_ROOT/scripts/doctor.py" --manifest "$RECAST_MODEL_MANIFEST"
fi
echo "Setup complete. Reconnect with: python3 scripts/vast.py open"
