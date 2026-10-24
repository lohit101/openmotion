import { describe, expect, it } from 'vitest';
import { activeDownloads, setupNotice } from '../shared/cloud-status';
import type { CloudLaunch } from '../shared/cloud';

const launch = (values: Partial<CloudLaunch>) => ({ id: 'one', createdAt: '2026-10-24T09:00:00Z', phase: 'installing', message: 'Installing', ...values } as CloudLaunch);
describe('GPU setup status', () => {
  it('shows only active file percentages from actual download logs', () => {
    const result = activeDownloads(['  wan2.1_14B_SCAIL_2_int8_convrot.safetensors: 52%', '  umt5_xxl_fp8_e4m3fn_scaled.safetensors: 99%', 'Verified: umt5_xxl_fp8_e4m3fn_scaled.safetensors', '  wan2.1_14B_SCAIL_2_int8_convrot.safetensors: 57%', '  sam3.1_multiplex_fp16.safetensors: 39%']);
    expect(result.map(r => [r.label, r.percent])).toEqual([['Main video model', 57], ['Person tracker', 39]]);
    expect(activeDownloads(['Installing runtime', 'Downloading file (0.00 / 16.65 GB)'])).toEqual([]);
    expect(activeDownloads(['  clip_vision_h.safetensors: 80%', 'Ready: clip_vision/clip_vision_h.safetensors'])).toEqual([]);
  });
  it('reports a slow setup as a warning and keeps its notification identity stable as progress changes', () => {
    const first = setupNotice(launch({ setupSlow: true }));
    expect(first?.tone).toBe('warning'); expect(first?.title).toBe('Taking longer than usual');
    expect(setupNotice(launch({ setupSlow: true, message: 'Main model 60%' }))?.key).toBe(first?.key);
  });
  it('reports actual failures in red, including when failed compute was stopped, and success when ready', () => {
    expect(setupNotice(launch({ phase: 'stopped', failureCode: 'setup-failed', lastFailure: 'Model checksum failed' }))?.tone).toBe('error');
    expect(setupNotice(launch({ phase: 'stopping', failureCode: 'setup-failed', lastFailure: 'Model checksum failed' }))?.tone).toBe('error');
    expect(setupNotice(launch({ phase: 'stopped' }))).toBeNull();
    expect(setupNotice(launch({ phase: 'ready', setupSlow: true }))?.tone).toBe('success');
  });
});
