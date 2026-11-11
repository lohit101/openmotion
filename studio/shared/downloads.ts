import { isRetiredModel, modelDefinitions, type ModelInventory, type ModelsState } from './models';
import openjutsuModels from '../../config/openjutsu-models.lock.json';
import localFace from '../../config/local-identity.lock.json';
import videoFace from '../../config/local-video-identity.lock.json';

export const faceStorageFiles = [...localFace.files, ...videoFace.files].filter(file => !/(?:^|\/)nsfw_\d+\./.test(file.path)).map(file => 'face-refinement/' + file.path.split('/').at(-1));
export const deletableModelFile = (id: string) => !/[\\\x00-\x1f\x7f]/.test(id) && id.split('/').every(part => part && part !== '.' && part !== '..') &&
  (modelDefinitions.some(file => file.id === id) || faceStorageFiles.includes(id) || id.startsWith('loras/') && id.endsWith('.safetensors'));

export function modelUsage(id: string): { workflow: string; detail: string }[] {
  if (isRetiredModel(id)) return [{ workflow: 'Retired files', detail: 'Stored for historical runs. New downloads are disabled; delete explicitly to free space.' }];
  const file = modelDefinitions.find(item => item.id === id);
  if (!file) return [{ workflow: 'Custom LoRA', detail: 'Check compatibility with the selected model.' }];
  if (id === 'text_encoders/qwen3vl_8b_int8_convrot.safetensors') return [
    { workflow: 'Remotion', detail: 'Native visual description encoder.' },
    { workflow: 'Imagen', detail: 'Qwen Image 2.1 visual encoder, shared with Remotion.' },
  ];
  if (/^(ultralytics|sams|insightface)\//.test(id)) return [{ workflow: 'Fix Faces', detail: 'Native OpenJutsu face detection, tracking and masks.' }];
  if (file.engine === 'openjutsu' || openjutsuModels.shared.includes(id)) return [{ workflow: 'Remotion', detail: 'Native OpenJutsu motion transfer. Only selected components are required.' }];
  if (file.engine === 'smooth-motion') return [{ workflow: 'Smooth Motion', detail: 'Optional 30/48/60fps finishing, standalone or after Remotion.' }];
  if (file.engine === 'upscale') return [{ workflow: 'Clarity', detail: 'FlashVSR+ Turbo video upscaling.' }];
  return [{ workflow: 'Imagen', detail: file.filename.includes('turbo') ? 'Optional Turbo 8-step adapter.' : file.filename.includes('consistency') ? 'Optional image-consistency adapter.' : file.filename.includes('bfs_head') ? 'Optional BFS V1.1 alternative head-swap adapter.' : 'Qwen Image 2.1 image editing.' }];
}

export const inventoryKey = (instanceId: number | null, endpoint: string) => instanceId ? `vast:${instanceId}` : `endpoint:${endpoint}`;

export function downloadRows(state: ModelsState, inventory?: ModelInventory, live = false) {
  const stored = new Map(inventory?.files.filter(file => !/(?:^|\/)nsfw_\d+\./.test(file.id)).map(file => [file.id, file]));
  const ids = new Set([...stored.keys(), ...(live ? state.installedLoras.map(file => 'loras/' + file.name) : [])]);
  const definitions = [...modelDefinitions, ...[...ids].filter(id => !modelDefinitions.some(file => file.id === id)).map(id => ({
    id, filename: id.replace(/^loras\//, ''), label: id.split('/').at(-1)!, description: id.startsWith('face-refinement/')?'Retired face-refinement file retained on disk. Delete explicitly to free space.':'Uploaded custom LoRA', size: stored.get(id)?.size || state.installedLoras.find(file => 'loras/' + file.name === id)?.size || 0,
    group: id.startsWith('face-refinement/')?'core':'adapter', included: false,
  }))];
  return definitions.map(file => {
    const current = live ? state.files.find(item => item.id === file.id) : undefined, saved = stored.get(file.id);
    const lora = live ? state.installedLoras.find(item => 'loras/' + item.name === file.id) : undefined;
    const bytes = saved?.size ?? lora?.size ?? (current?.status === 'installed' ? file.size : 0);
    const installed = bytes > 0;
    const partial = current?.status === 'downloading' ? current.downloaded || 0 : saved?.partialSize || lora?.partialSize || (!installed ? current?.downloaded : 0) || 0;
    return { ...file, retired: isRetiredModel(file.id), usage: modelUsage(file.id), installed, bytes, partial, onDisk: bytes + partial,
      status: current?.status === 'failed' ? 'failed' : current?.status === 'downloading' || current?.status === 'queued' || current?.status === 'reconnecting' ? current.status : installed ? current?.status === 'missing' ? 'unavailable' : 'installed' : partial ? 'partial' : 'missing',
      progress: current, measured: !!saved?.measured || !!lora,
    };
  }).filter(file => !file.retired || file.onDisk > 0 || file.progress?.remoteActive || ['queued', 'downloading', 'reconnecting'].includes(file.status));
}
