import type {Store} from './store';
import type {MarketRequirements,OfferFilters} from '../shared/cloud';
import {emptyImageEditDraft,imageEditDraftSchema,imageEditFiles} from '../shared/image-edit';
import {openjutsuDraftSchema,emptyOpenjutsuDraft,openjutsuFiles} from '../shared/openjutsu';
import {imageFilesForSettings,modelBytes,modelFilesForSettings,modelWorkingReserve,upscaleModelFiles} from '../shared/models';

export function marketRequirements(store:Store,filters:OfferFilters):{requirements:MarketRequirements;filters:OfferFilters}{
  const motion=openjutsuFiles(openjutsuDraftSchema.parse(store.value('openjutsu-draft',emptyOpenjutsuDraft())).settings),image=imageFilesForSettings(store.imageDraft().settings);
  const edit=imageEditDraftSchema.parse(store.value('image-edit-draft',emptyImageEditDraft())).settings;
  const editing=imageEditFiles(edit);
  const files=[...new Set(filters.workflow==='image-edit'?editing:filters.workflow==='imagen'?image:filters.workflow==='clarity'?upscaleModelFiles:filters.workflow==='all'?[...motion,...image,...editing,...upscaleModelFiles]:motion)];
  const minDisk=Math.max(filters.workflow==='all'?96:64,Math.ceil((modelBytes(files)+20e9+modelWorkingReserve(files))/1e9/8)*8);
  const requirements:MarketRequirements={workflow:filters.workflow,minVram:['image-edit','all'].includes(filters.workflow)?edit.resolution==='2k'?48:24:24,minRam:['remotion','image-edit','all'].includes(filters.workflow)?64:48,minDisk,recommendedDisk:minDisk+16,modelGB:modelBytes(files)/1e9,architectures:['clarity','all'].includes(filters.workflow)?['amd64']:['amd64','arm64']};
  return {requirements,filters:{...filters,minVram:Math.max(filters.minVram,requirements.minVram),ram:Math.max(filters.ram,requirements.minRam),disk:Math.max(filters.disk,requirements.minDisk)}};
}
