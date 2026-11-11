import { afterEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApplication } from '../server/index';

let folder='',local:Awaited<ReturnType<typeof createApplication>>|undefined;
afterEach(async()=>{local?.idle.dispose();local?.models.dispose();local?.cloud.dispose();local?.store.close();if(folder)await rm(folder,{recursive:true,force:true});});
async function fixture(){folder=await mkdtemp(path.join(os.tmpdir(),'module-queue-api-'));local=await createApplication({dataRoot:folder,seed:false,allowSSH:false,cloudOptions:{backgroundSafety:false}});return local;}

it('accepts a module queue request during owned Clarity installation, but rejects actual upscaling',async()=>{
  const f=await fixture(),prepare=vi.spyOn(f.models,'prepareModule').mockResolvedValue(f.models.state);
  vi.spyOn(f.upscale,'busy','get').mockReturnValue(true);f.models.preparingClarity=true;
  await request(f.app).post('/api/models/module').send({module:'clarity'}).expect(202);
  expect(prepare).toHaveBeenCalledOnce();f.models.preparingClarity=false;
  await request(f.app).post('/api/models/module').send({module:'clarity'}).expect(409);
  expect(prepare).toHaveBeenCalledOnce();expect(f.store.jobs()).toEqual([]);
});

it('blocks resume during generation or idle pause while allowing pause/cancel',async()=>{
  const f=await fixture(),action=vi.spyOn(f.models,'moduleAction').mockResolvedValue(f.models.state);
  vi.spyOn(f.upscale,'busy','get').mockReturnValue(true);
  await request(f.app).post('/api/models/module/action').send({key:'accepted',action:'resume'}).expect(409);
  await request(f.app).post('/api/models/module/action').send({key:'accepted',action:'pause'}).expect(200);
  f.idle.state.status='pausing';
  await request(f.app).post('/api/models/module/action').send({key:'accepted',action:'resume'}).expect(409);
  await request(f.app).post('/api/models/module/action').send({key:'accepted',action:'cancel'}).expect(200);
  expect(action.mock.calls.map(c=>c[1])).toEqual(['pause','cancel']);
});

it('validates the exact queue action contract without starting provider or model work',async()=>{
  const f=await fixture(),action=vi.spyOn(f.models,'moduleAction').mockResolvedValue(f.models.state);
  for(const body of [{key:'',action:'resume'},{key:'a',action:'start'},{key:'a',action:'resume',instanceId:999}]){
    await request(f.app).post('/api/models/module/action').send(body).expect(422);
  }
  expect(action).not.toHaveBeenCalled();expect(f.store.jobs()).toEqual([]);
});
