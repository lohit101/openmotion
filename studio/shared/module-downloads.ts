import { z } from 'zod';
import { openjutsuFiles, openjutsuFaceFiles, openjutsuSettingsSchema, type OpenjutsuSettings } from './openjutsu';
import { imageEditFiles, imageEditSettingsSchema, type ImageEditSettings } from './image-edit';
import { settingsSchema, type Settings } from './types';
import { imageSettingsSchema, type ImageSettings } from './image-replacement';
import { facialVersionForSettings, usesFacialConsistency } from './facial-consistency';
import { imageFilesForSettings, modelDefinitions, modelFilesForSettings, upscaleModelFiles, type DownloadModule, type ModuleDownloadPlan, type ModelsState } from './models';

export const moduleDownloadRequestSchema=z.discriminatedUnion('module',[
  z.object({module:z.literal('remotion'),settings:settingsSchema}).strict(),
  z.object({module:z.literal('imagen'),settings:imageSettingsSchema}).strict(),
  z.object({module:z.literal('image-edit'),settings:imageEditSettingsSchema}).strict(),
  z.object({module:z.literal('clarity')}).strict(),
  z.object({module:z.literal('openjutsu'),settings:openjutsuSettingsSchema}).strict(),
  z.object({module:z.literal('openjutsu-face'),settings:openjutsuSettingsSchema}).strict(),
]);
export type ModuleDownloadRequest=z.infer<typeof moduleDownloadRequestSchema>;
export const moduleNames:Record<DownloadModule,string>={remotion:'Remotion',openjutsu:'Remotion','openjutsu-face':'Fix Faces',imagen:'Imagen','image-edit':'Image Edit',clarity:'Clarity'};
export function moduleDownloadPlan(module:'openjutsu-face',settings:OpenjutsuSettings):ModuleDownloadPlan;
export function moduleDownloadPlan(module:'openjutsu',settings:OpenjutsuSettings):ModuleDownloadPlan;
export function moduleDownloadPlan(module:'remotion',settings:Settings):ModuleDownloadPlan;
export function moduleDownloadPlan(module:'imagen',settings:ImageSettings):ModuleDownloadPlan;
export function moduleDownloadPlan(module:'image-edit',settings:ImageEditSettings):ModuleDownloadPlan;
export function moduleDownloadPlan(module:'clarity'):ModuleDownloadPlan;
export function moduleDownloadPlan(module:DownloadModule,settings?:Settings|ImageSettings|ImageEditSettings|OpenjutsuSettings):ModuleDownloadPlan{
  const files=[...new Set(module==='openjutsu-face'?openjutsuFaceFiles(settings as OpenjutsuSettings):module==='openjutsu'?openjutsuFiles(settings as OpenjutsuSettings):module==='remotion'?modelFilesForSettings(settings as Settings):module==='image-edit'?imageEditFiles(settings as ImageEditSettings):module==='imagen'?imageFilesForSettings(settings as ImageSettings):upscaleModelFiles)];
  const image=settings as ImageSettings;
  const runtimes=module==='openjutsu-face'?['openjutsu-face-tools']:module==='openjutsu'?['openjutsu-tools']:module==='remotion'?( (settings as Settings).engine==='viggle'?['viggle-tools',...(usesFacialConsistency(settings as Settings)?['facial:'+facialVersionForSettings(settings as Settings)]:[])]:[]):module==='clarity'?['clarity']:module==='imagen'&&!image.workflow&&image.qwenRecipe!=='clothing-only'?[...(image.localIdentity?['localIdentity']:[]),...(image.qwenRecipe==='body-identity'&&image.qwenBodyPose||image.qwenRecipe==='body-only'&&image.bodyOnlyStrategy==='staged'&&image.bodyOnlyPose?['localPose']:[])]:[];
  return {module,files,runtimes,key:JSON.stringify({module,files:[...files].sort(),runtimes})};
}
export function planFromRequest(request:ModuleDownloadRequest){
  return request.module==='openjutsu-face'?moduleDownloadPlan('openjutsu-face',request.settings):request.module==='openjutsu'?moduleDownloadPlan('openjutsu',request.settings):request.module==='image-edit'?moduleDownloadPlan('image-edit',request.settings):request.module==='remotion'?moduleDownloadPlan('remotion',request.settings):request.module==='imagen'?moduleDownloadPlan('imagen',request.settings):moduleDownloadPlan('clarity');
}

export function moduleDownloadProgress(plan:ModuleDownloadPlan,state:ModelsState,transferFiles?:string[]){
  const selected=new Set(plan.files),scoped=state.moduleSetup?.key===plan.key?state.moduleSetup:undefined;
  const transfers=new Set(transferFiles||scoped?.transferFiles||plan.files.filter(id=>state.files.find(f=>f.id===id)?.status!=='installed'));
  const required=modelDefinitions.filter(f=>selected.has(f.id));
  const missing=required.filter(f=>state.files.find(s=>s.id===f.id)?.status!=='installed');
  const items=required.filter(f=>transfers.has(f.id));
  const total=items.reduce((sum,f)=>sum+f.size,0);
  const downloaded=items.reduce((sum,f)=>{const live=state.files.find(s=>s.id===f.id);return sum+(live?.status==='installed'?f.size:Math.min(f.size,Math.max(0,live?.downloaded||0)));},0);
  const active=state.files.some(f=>selected.has(f.id)&&['queued','downloading','reconnecting'].includes(f.status));
  return {scoped,missing:missing.map(f=>f.id),remaining:missing.reduce((sum,f)=>sum+f.size-Math.min(f.size,Math.max(0,state.files.find(s=>s.id===f.id)?.downloaded||0)),0),
    total,downloaded,percent:total?Math.min(active?99:100,Math.floor(downloaded/total*100)):0,
    active:active||!!scoped&&(['downloading','preparing','reconnecting'].includes(scoped.status)||!!scoped.activeRuntime),
    reconnecting:state.files.some(f=>selected.has(f.id)&&f.status==='reconnecting')||scoped?.status==='reconnecting'||scoped?.status==='cancelled'&&!!scoped.activeRuntime,
    failed:state.files.some(f=>selected.has(f.id)&&f.status==='failed')||scoped?.status==='failed'};
}
