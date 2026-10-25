import base from '../../config/models.lock.json';
import relight from '../../config/optional-models.lock.json';
import natural from '../../config/natural-models.lock.json';
import extras from '../../config/extra-models.lock.json';
import setup from '../../config/setup-models.json';
import type { Settings } from './types';
import { usesSpeedAdapter } from './sampling';

export const RELIGHT = 'wan2.1_SCAIL_2_relight_lora_bf16.safetensors';
export const NATURAL_SPEED = 'lightx2v_T2V_14B_cfg_step_distill_v2_lora_rank64_bf16.safetensors';
export const I2V_SPEED = 'lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors';
export const DPO = 'wan2.1_SCAIL_2_DPO_lora_bf16.safetensors';
export const SOCIAL_STYLE = 'Instagoon-v1-step00001400.safetensors';
export const pinnedModels = [...base.files, ...relight.files, ...natural.files, ...extras.files];
export const setupModelFiles: string[] = setup.files;
const filename = (destination: string) => destination.split('/').at(-1)!;

// Describe requirements only. Selection never initiates a download.
export function modelFilesForSettings(s: Settings): string[] {
  const adapters = new Set<string>();
  if (s.dpoStrength > 0) adapters.add(DPO);
  if (usesSpeedAdapter(s.preset)) adapters.add(s.preset === 'natural' && s.mode === 'swap' ? NATURAL_SPEED : I2V_SPEED);
  if (s.relight && s.mode === 'swap' && s.relightStrength > 0) adapters.add(RELIGHT);
  for (const name of [s.loraA, s.loraB]) if (name !== 'None') adapters.add(name);
  return pinnedModels.filter(file => !file.destination.startsWith('loras/') || adapters.has(filename(file.destination)))
    .map(file => file.destination);
}

export function presetModelFiles(preset: Settings['preset'], mode: Settings['mode']): string[] {
  return usesSpeedAdapter(preset) ? ['loras/' + (preset === 'natural' && mode === 'swap' ? NATURAL_SPEED : I2V_SPEED)] : [];
}

const descriptions: Record<string, [string, string, 'core' | 'adapter']> = {
  'wan2.1_14B_SCAIL_2_int8_convrot.safetensors': ['SCAIL-2 INT8', 'Character replacement and motion generation', 'core'],
  'umt5_xxl_fp8_e4m3fn_scaled.safetensors': ['Text encoder', 'Reads the positive and negative prompts', 'core'],
  'clip_vision_h.safetensors': ['Reference encoder', 'Reads your character reference image', 'core'],
  'Wan2_1_VAE_bf16.safetensors': ['Video encoder / decoder', 'Converts frames to and from model latents', 'core'],
  'sam3.1_multiplex_fp16.safetensors': ['Person tracker', 'Tracks the character and builds replacement masks', 'core'],
  [DPO]: ['Detail adapter', 'SCAIL-2 DPO: character detail, eyes and hands', 'adapter'],
  [I2V_SPEED]: ['Fast / motion acceleration', 'Fast 6-step generation; also used by Natural in Motion transfer', 'adapter'],
  [NATURAL_SPEED]: ['Natural / swap acceleration', 'Natural 8-step Character swap', 'adapter'],
  [RELIGHT]: ['Character relighting', 'Matches the replacement to source lighting and shadows', 'adapter'],
  [SOCIAL_STYLE]: ['Social media style · Instagooner', 'Casual influencer / phone-camera aesthetics. Video quality on SCAIL-2 is untested.', 'adapter'],
};
export const modelDefinitions = pinnedModels.map(file => {
  const [label, description, group] = descriptions[filename(file.destination)];
  return { id: file.destination, filename: filename(file.destination), size: file.size, label, description, group,
    included: group === 'core', experimental: filename(file.destination) === SOCIAL_STYLE,
    trigger: filename(file.destination) === SOCIAL_STYLE ? 'instag00n' : '',
    source: filename(file.destination) === SOCIAL_STYLE ? extras.files[0].source : '' };
});
export type ModelStatus = 'unknown' | 'missing' | 'queued' | 'downloading' | 'installed' | 'failed';
export interface ModelTransfer { downloaded: number; total: number; bytesPerSecond?: number; }
export interface ModelFileState { id: string; status: ModelStatus; percent: number | null; message: string; error: string | null; downloaded?: number; total?: number; bytesPerSecond?: number; }
export interface InstalledLora { name: string; size: number; partialSize?: number; included: boolean; }
export interface ModelsState { files: ModelFileState[]; busy: boolean; refreshing: boolean; error: string | null; checkedAt: string | null; installedLoras: InstalledLora[]; deleting: string | null; }
export const emptyModels = (): ModelsState => ({ files: modelDefinitions.map(file => ({ id: file.id, status: 'unknown', percent: null, message: '', error: null })), busy: false, refreshing: false, error: null, checkedAt: null, installedLoras: [], deleting: null });

export function modelBytes(files: string[]): number {
  const selected = new Set(files);
  if (files.some(name => !pinnedModels.some(file => file.destination === name))) throw new Error('Unknown setup model.');
  return pinnedModels.filter(file => selected.has(file.destination)).reduce((total, file) => total + file.size, 0);
}
