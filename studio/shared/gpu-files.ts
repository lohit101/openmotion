import { z } from 'zod';
import { faceStorageFiles } from './downloads';
import { modelDefinitions, downloadableModelDefinitions } from './models';

export const gpuFileRoots = {
  models: 'Model files', input: 'Uploaded media', output: 'Generated files', temp: 'Temporary files',
  workspace: 'Recast workspace', comfy: 'ComfyUI installation',
} as const;
const relativePath = z.string().max(1200).refine(value => !/[\\\x00-\x1f\x7f]/.test(value) &&
  (value === '' || value.split('/').every(part => part && part !== '.' && part !== '..')), 'Choose a relative GPU file path.');
export const gpuFileLocationSchema = z.object({ instanceId: z.number().int().positive(), root: z.enum(Object.keys(gpuFileRoots) as [keyof typeof gpuFileRoots, ...Array<keyof typeof gpuFileRoots>]), path: relativePath.default('') }).strict();
export const gpuFileListSchema = gpuFileLocationSchema.extend({ offset: z.number().int().min(0).max(1_000_000).default(0) });
export const gpuFileDeleteSchema = gpuFileLocationSchema.extend({ path: relativePath.refine(value => !!value, 'Choose a file.'), token: z.string().regex(/^[a-f0-9]{64}$/) });
export type GpuFileLocation = z.infer<typeof gpuFileLocationSchema>;
export type GpuFileListRequest = z.infer<typeof gpuFileListSchema>;
export type GpuFileDeleteRequest = z.infer<typeof gpuFileDeleteSchema>;
export interface GpuFileEntry { name: string; path: string; kind: 'directory' | 'file' | 'link' | 'other'; size: number; modifiedAt: string; token: string; deletable: boolean; }
export interface GpuFileListing extends GpuFileLocation {
  absolutePath: string; checkedAt: string; entries: GpuFileEntry[]; total: number; nextOffset: number | null;
  freeBytes: number; totalBytes: number; usedBytes: number;
}
export interface GpuFileRemoval extends GpuFileDeleteRequest { removed: boolean; freedBytes: number; freeBytes: number; }

// Only pinned files can be restored by a module. Other GPU files remain removable,
// but the UI must not promise that an uploaded/custom file can be downloaded again.
export function gpuFileModelId(location: Pick<GpuFileLocation, 'root' | 'path'>): string | undefined {
  let id = location.root === 'models' ? location.path : location.root === 'workspace' && location.path.startsWith('models/') ? location.path.slice(7) : '';
  id = id.replace(/(?:\.part|\.verified\.json)$/, '');
  if (modelDefinitions.some(file => file.id === id)) return id;
  if (location.root === 'workspace' && location.path.startsWith('face-refinement-runtime/')) {
    const face = 'face-refinement/' + location.path.split('/').at(-1)!.replace(/\.part$/, '');
    if (faceStorageFiles.includes(face)) return face;
  }
  return undefined;
}
export const gpuFileRestorable = (location: Pick<GpuFileLocation, 'root' | 'path'>) => downloadableModelDefinitions.some(file => file.id === gpuFileModelId(location));
