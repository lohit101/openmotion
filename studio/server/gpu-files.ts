import path from 'node:path';
import { command } from './media';
import type { GpuFileDeleteRequest, GpuFileListing, GpuFileListRequest, GpuFileRemoval } from '../shared/gpu-files';

export async function manageGpuFiles(repo: string, request: GpuFileListRequest, action: 'list'): Promise<GpuFileListing>;
export async function manageGpuFiles(repo: string, request: GpuFileDeleteRequest, action: 'delete'): Promise<GpuFileRemoval>;
export async function manageGpuFiles(repo: string, request: GpuFileListRequest | GpuFileDeleteRequest, action: 'list' | 'delete'): Promise<GpuFileListing | GpuFileRemoval> {
  const args = ['-u', path.join(repo, 'scripts/managed_gpu_files.py'), '--instance-id', String(request.instanceId), '--request', JSON.stringify(request)];
  if (action === 'delete') args.push('--delete');
  const output = await command('python3', args, undefined, 30000);
  const line = output.split(/\r?\n/).findLast(line => line.startsWith('RECAST_GPU_FILES '));
  if (!line) throw new Error('The GPU did not return a file-storage result. Refresh before retrying.');
  const result = JSON.parse(line.slice(17));
  if (result.instanceId !== request.instanceId || result.root !== request.root || result.path !== request.path ||
    !Number.isFinite(result.freeBytes) || result.freeBytes < 0) throw new Error('The file-storage response belongs to a different GPU or folder.');
  if (action === 'list' && (!Array.isArray(result.entries) || !Number.isInteger(result.total) || !Number.isFinite(result.totalBytes) ||
    typeof result.absolutePath !== 'string' || typeof result.checkedAt !== 'string')) throw new Error('The GPU returned an incomplete file list.');
  if (action === 'delete' && (result.token !== (request as GpuFileDeleteRequest).token || typeof result.removed !== 'boolean' || !Number.isFinite(result.freedBytes) || result.freedBytes < 0)) throw new Error('The GPU did not confirm this exact file removal. Refresh before retrying.');
  return result;
}
