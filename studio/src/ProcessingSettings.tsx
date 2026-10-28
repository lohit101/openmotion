import { Cpu } from '@phosphor-icons/react';
import { Toggle } from './components';
import { setFaceExecution, useFaceExecution } from './face-preferences';

export default function ProcessingSettings() {
  const execution = useFaceExecution(), local = execution === 'local CPU';
  return <section className="settings-processing" aria-labelledby="processing-settings-heading">
    <h2 id="processing-settings-heading">Face refinement</h2>
    <p className="settings-description">Choose where FaceFusion and its ONNX models run.</p>
    <div className="processing-device-setting"><Toggle label="Run FaceFusion locally on this laptop" checked={local} onChange={value => setFaceExecution(value ? 'local CPU' : 'remote CUDA')} detail="On uses your laptop’s CPU and local face models. Off uses CUDA on your connected rented GPU. Each device needs its own explicit one-time setup. Changing this toggle starts no downloads or compute." />
      <div className="processing-device-summary" role="status"><Cpu size={18} /><div><strong>{local ? 'This laptop · CPU' : 'Rented GPU · CUDA'}</strong><p>{local ? 'Works offline once local FaceFusion is installed.' : 'Connect your GPU, then prepare its face models beside Refine face in Library.'}</p></div></div>
      <p className="settings-description">Applies to new face refinements. Running and saved results keep their original device.</p>
    </div>
  </section>;
}
