import type {Store} from './store';
import type {MarketRequirements,OfferFilters} from '../shared/cloud';
import {imageFilesForSettings,modelBytes,modelFilesForSettings,modelWorkingReserve,upscaleModelFiles} from '../shared/models';

export function marketRequirements(store:Store,filters:OfferFilters):{requirements:MarketRequirements;filters:OfferFilters}{
  const motion=modelFilesForSettings(store.draft().settings),image=imageFilesForSettings(store.imageDraft().settings);
  const files=[...new Set(filters.workflow==='imagen'?image:filters.workflow==='clarity'?upscaleModelFiles:filters.workflow==='all'?[...motion,...image,...upscaleModelFiles]:motion)];
  const minDisk=Math.max(filters.workflow==='all'?96:64,Math.ceil((modelBytes(files)+20e9+modelWorkingReserve(files))/1e9/8)*8);
  const requirements:MarketRequirements={workflow:filters.workflow,minVram:24,minRam:filters.workflow==='all'?64:48,minDisk,recommendedDisk:minDisk+16,modelGB:modelBytes(files)/1e9,architectures:['clarity','all'].includes(filters.workflow)?['amd64']:['amd64','arm64']};
  return {requirements,filters:{...filters,minVram:Math.max(filters.minVram,requirements.minVram),ram:Math.max(filters.ram,requirements.minRam),disk:Math.max(filters.disk,requirements.minDisk)}};
}
