import { useState } from 'react';
import { DownloadSimple } from '@phosphor-icons/react';
import { toast } from 'sonner';
import type { Settings } from '../shared/types';
import { facialModelFiles } from '../shared/models';
import { facialProfileLabels, type FacialProfile } from '../shared/facial-consistency';
import { FieldLabel } from './InfoTip';
import { api } from './components';
import { DownloadSelect, type DownloadControls } from './ModelDownloads';

export default function FacialConsistencyControls({ value, change, downloads }: {
  value: Settings['facialConsistency']; change: (value: FacialProfile) => void; downloads: DownloadControls;
}) {
  const [preparing, setPreparing] = useState(false);
  const installed = facialModelFiles.every(id => downloads.state.files.find(file => file.id === id)?.status === 'installed');
  const prepare = async () => {
    setPreparing(true);
    const id = toast.loading('Preparing facial tools', { description: 'Updating the isolated GPU runtime. Installed weights are reused.' });
    try { await api('/facial-consistency/prepare', {}); toast.success('Facial tools ready', { id }); }
    catch (error) { toast.error('Facial tools need attention', { id, description: (error as Error).message }); }
    finally { setPreparing(false); }
  };
  return <div className="full-label">
    <FieldLabel label="Facial consistency" help="Runs automatically after Viggle, before the video appears in Library. Standard matches the previous PerformRecast + 60% ONNX comparison. Regional reduces cheek/jaw/depth changes. Both copy visible source expressions, then blend a fixed-reference Hyperswap identity pass at 60%. No Library button is needed. Covered, uncertain or mismatched faces are preserved and reported. This does not guarantee exact gaze or identity. Uses an x86_64 CUDA GPU; downloads are explicit." />
    <DownloadSelect label="Facial consistency" value={value || 'off'} onChange={v => change(v as FacialProfile)} controls={downloads}
      options={(['off', 'perform-onnx60', 'regional-onnx60'] as const).map(profile => ({ value: profile, label: facialProfileLabels[profile], files: profile === 'off' ? [] : facialModelFiles }))} />
    {value !== 'off' && installed && !downloads.state.facialRuntimeReady && <button type="button" className="secondary-button" disabled={preparing || !downloads.online || downloads.blocked || downloads.state.busy} onClick={() => void prepare()}><DownloadSimple size={15} />{preparing ? 'Preparing face tools…' : 'Prepare / update facial tools'}</button>}
  </div>;
}
