import { DPO, IMAGE_IDENTITY, I2V_SPEED, NATURAL_SPEED, QWEN_HEAD, QWEN_STRUCTURE, RELIGHT, SOCIAL_STYLE, modelDefinitions, qwenImageModelFiles, type ModelInventory, type ModelsState } from './models';
import localFace from '../../config/local-identity.lock.json';
import videoFace from '../../config/local-video-identity.lock.json';

export const faceStorageFiles = [...localFace.files, ...videoFace.files].filter(file => !/(?:^|\/)nsfw_\d+\./.test(file.path)).map(file => 'face-refinement/' + file.path.split('/').at(-1));
export const deletableModelFile = (id: string) => !/[\\\x00-\x1f\x7f]/.test(id) && id.split('/').every(part => part && part !== '.' && part !== '..') &&
  (modelDefinitions.some(file => file.id === id) || faceStorageFiles.includes(id) || id.startsWith('loras/') && id.endsWith('.safetensors'));

export function modelUsage(id: string): { workflow: string; detail: string }[] {
  if(id.startsWith('face-refinement/'))return [{workflow:'GPU face refinement',detail:'Separate CUDA Hyperswap pass after video generation; also includes detection and occlusion.'}];
  const file = modelDefinitions.find(item => item.id === id);
  if (!file) return [{ workflow: 'Custom LoRA', detail: 'LoRA slots; check compatibility with the selected model.' }];
  if (file.engine === 'viggle') return [{ workflow: 'Viggle video', detail: 'Remotion · all Viggle quality presets' }];
  if (file.engine === 'upscale') return [{ workflow: 'Clarity', detail: 'Optional FlashVSR+ Turbo video upscaling. Separate runtime preparation required.' }];
  if (file.engine === 'facial') return [{ workflow: 'Remotion facial consistency', detail: 'Standard or Regional expression transfer followed by 60% ONNX identity correction' }];
  if (id === 'loras/' + IMAGE_IDENTITY) return [{ workflow: 'Klein images', detail: 'Optional separate identity pass' }];
  if (/flux-2-klein|qwen_3_4b|flux2-vae/.test(file.filename)) return [
    { workflow: 'Klein images', detail: 'Character and outfit replacement' },
    { workflow: 'Viggle video', detail: 'Automatic source-frame preparation only' },
  ];
  if (id === QWEN_STRUCTURE) return [{ workflow: 'Qwen images', detail: 'Source geometry strength above zero' }];
  if (file.filename === QWEN_HEAD) return [{ workflow: 'Qwen images', detail: 'Optional separate head identity pass' }];
  if (file.engine === 'repaint') return [{ workflow: 'Qwen images', detail: file.filename.includes('turbo') ? 'Fast 8-step edits and legacy whole-person swap' : file.filename.includes('body_swap') ? 'Character and complete outfit transfer' : 'Shared by Qwen image replacement recipes' }, ...(qwenImageModelFiles.includes(id) ? [{ workflow: 'Viggle video', detail: 'Remotion · automatic Imagen segment repaints when enabled' }] : [])];
  const detail = file.filename === NATURAL_SPEED ? 'Accelerated character-swap presets'
    : file.filename === I2V_SPEED ? 'Fast presets and accelerated motion transfer'
    : file.filename === DPO ? 'Detail adapter strength above zero'
    : file.filename === RELIGHT ? 'Character relighting enabled'
    : file.filename === SOCIAL_STYLE ? 'Optional social-media style in LoRA A or B'
    : 'Shared by SCAIL-2 character swap and motion transfer';
  return [{ workflow: 'SCAIL-2 video', detail }];
}

export const inventoryKey = (instanceId: number | null, endpoint: string) => instanceId ? `vast:${instanceId}` : `endpoint:${endpoint}`;

export function downloadRows(state: ModelsState, inventory?: ModelInventory, live = false) {
  const stored = new Map(inventory?.files.filter(file => !/(?:^|\/)nsfw_\d+\./.test(file.id)).map(file => [file.id, file]));
  const ids = new Set([...stored.keys(), ...(live ? state.installedLoras.map(file => 'loras/' + file.name) : [])]);
  const definitions = [...modelDefinitions, ...[...ids].filter(id => !modelDefinitions.some(file => file.id === id)).map(id => ({
    id, filename: id.replace(/^loras\//, ''), label: id.split('/').at(-1)!, description: id.startsWith('face-refinement/')?'Pinned face-refinement dependency in the isolated GPU runtime. Prepare it beside Refine face in Library. This is not a video-generation LoRA.':'Uploaded custom LoRA', size: stored.get(id)?.size || state.installedLoras.find(file => 'loras/' + file.name === id)?.size || 0,
    group: id.startsWith('face-refinement/')?'core':'adapter', included: false,
  }))];
  return definitions.map(file => {
    const current = live ? state.files.find(item => item.id === file.id) : undefined, saved = stored.get(file.id);
    const lora = live ? state.installedLoras.find(item => 'loras/' + item.name === file.id) : undefined;
    const bytes = saved?.size ?? lora?.size ?? (current?.status === 'installed' ? file.size : 0);
    const installed = bytes > 0;
    const partial = current?.status === 'downloading' ? current.downloaded || 0 : saved?.partialSize || lora?.partialSize || (!installed ? current?.downloaded : 0) || 0;
    return { ...file, usage: modelUsage(file.id), installed, bytes, partial, onDisk: bytes + partial,
      status: current?.status === 'failed' ? 'failed' : current?.status === 'downloading' || current?.status === 'queued' || current?.status === 'reconnecting' ? current.status : installed ? current?.status === 'missing' ? 'unavailable' : 'installed' : partial ? 'partial' : 'missing',
      progress: current, measured: !!saved?.measured || !!lora,
    };
  });
}
