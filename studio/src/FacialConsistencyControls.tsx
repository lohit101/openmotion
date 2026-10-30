import { useState } from 'react';
import { DownloadSimple } from '@phosphor-icons/react';
import { toast } from 'sonner';
import type { Settings } from '../shared/types';
import { facialFilesForSettings } from '../shared/models';
import { facialProfileLabels, facialRuntimeReadyForSettings, type FacialProfile } from '../shared/facial-consistency';
import { FieldLabel } from './InfoTip';
import { api, Toggle } from './components';
import { DownloadSelect, type DownloadControls } from './ModelDownloads';

export default function FacialConsistencyControls({ value, change, downloads, sceneMatch, changeSceneMatch, cleanup, changeCleanup, eyeCalibration, changeEyeCalibration }: {
  value: Settings['facialConsistency']; change: (value: FacialProfile) => void; downloads: DownloadControls;
  sceneMatch?: boolean; changeSceneMatch?: (value: boolean) => void;
  cleanup?: boolean; changeCleanup?: (value: boolean) => void;
  eyeCalibration?: boolean; changeEyeCalibration?: (value: boolean) => void;
}) {
  const [preparing, setPreparing] = useState(false);
  const active = !!value && value !== 'off';
  const settings = { engine: 'viggle', facialConsistency: value, facialSceneMatch: sceneMatch, facialFeatureCleanup: cleanup ?? true, facialEyeCalibration: eyeCalibration === true };
  const files = facialFilesForSettings(settings);
  const installed = files.every(id => downloads.state.files.find(file => file.id === id)?.status === 'installed');
  const prepare = async () => {
    setPreparing(true);
    const id = toast.loading('Preparing facial tools', { description: 'Updating the isolated GPU runtime. Installed weights are reused.' });
    try { await api('/facial-consistency/prepare', {}); toast.success('Facial tools ready', { id }); }
    catch (error) { toast.error('Facial tools need attention', { id, description: (error as Error).message }); }
    finally { setPreparing(false); }
  };
  return <div className="full-label">
    <FieldLabel label="Facial consistency" help="Runs automatically after Viggle, before the video appears in Library. Standard uses the accepted PerformRecast source expressions; Regional reduces cheek/jaw/depth changes. Both blend a fixed-reference Hyperswap identity pass at 60%. Feature cleanup owns complete eyes and eyebrows and restores gated native eye detail. Covered, uncertain or mismatched faces are preserved and reported. This does not guarantee exact gaze or identity. Uses an x86_64 CUDA GPU; downloads are explicit." />
    <DownloadSelect label="Facial consistency" value={value || 'off'} onChange={v => change(v as FacialProfile)} controls={downloads}
      options={(['off', 'perform-onnx60', 'regional-onnx60'] as const).map(profile => ({ value: profile, label: facialProfileLabels[profile], files: profile === 'off' ? [] : files }))} />
    {active && changeSceneMatch && <Toggle label="Match face to scene" checked={sceneMatch !== false} onChange={changeSceneMatch}
      detail="Keeps the same expression and 60% identity blend, with bounded lighting/detail correction and inward edge blending. Preserves the surrounding hair, body and scene. Uses the existing models. Turn off for the original facial finish." />}
    {active && sceneMatch !== false && changeCleanup && <Toggle label="Clean eye and eyebrow edges" checked={cleanup !== false} onChange={changeCleanup}
      detail="Keeps the selected source-expression profile. Uses complete feature masks and gated eye detail, with one extra 94 MB parser. Turn off for the previous scene-matched finish." />}
    {value === 'perform-onnx60' && sceneMatch !== false && cleanup !== false && changeEyeCalibration && <Toggle label="Calibrate eye appearance" checked={eyeCalibration === true} onChange={changeEyeCalibration}
      detail="Uses the matching source moment and your edited reference to improve eye appearance. Keeps source mouth and jaw performance. Requires the reference timestamp to match the video; unclear anchor faces or eyes skip calibration with a saved reason. Uses the installed models." />}
    {active && installed && !facialRuntimeReadyForSettings(settings, downloads.state) && <button type="button" className="secondary-button" disabled={preparing || !downloads.online || downloads.blocked || downloads.state.busy} onClick={() => void prepare()}><DownloadSimple size={15} />{preparing ? 'Preparing face tools…' : 'Prepare / update facial tools'}</button>}
  </div>;
}
