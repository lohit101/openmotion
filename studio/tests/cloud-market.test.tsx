import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {renderToStaticMarkup} from 'react-dom/server';
import {normalizeOffer,VastClient,CloudManager} from '../server/cloud';
import {offerFiltersSchema,offerMatchesFilters} from '../shared/cloud';
import {rankGpuOffers,recommendationWeights} from '../shared/cloud-recommendations';
import {marketRequirements} from '../server/cloud-market';
import {Store} from '../server/store';
import GpuMarketplace from '../src/GpuMarketplace';
import GpuHardwareDetails from '../src/GpuHardwareDetails';

const filters=offerFiltersSchema.parse({});
const raw=(values:Record<string,unknown>={})=>({id:1,ask_contract_id:1,machine_id:1,gpu_name:'RTX 4500Ada',gpu_arch:'nvidia',compute_cap:890,num_gpus:1,gpu_ram:24576,cpu_ram:64000,cpu_cores_effective:12,cpu_name:'Fixture CPU',cpu_arch:'amd64',verification:'verified',reliability2:.995,driver_version:'595.84',cuda_max_good:13,disk_space:1024,disk_bw:1000,inet_down:1000,inet_up:500,inet_down_cost:.001,inet_up_cost:.002,direct_port_count:2,pcie_bw:24,dlperf:120,gpu_mem_bw:936,total_flops:40,search:{gpuCostPerHour:.3,diskHour:.02,totalHour:.32},rentable:true,rented:false,...values});
const offer=(id:number,values:Record<string,unknown>={})=>normalizeOffer(raw({id,ask_contract_id:id,machine_id:id,...values}),filters,30);
const reply=(offers:unknown[],truncated=false)=>new Response(JSON.stringify({offers,truncated}),{headers:{'Content-Type':'application/json'}});

describe('hardware-wide GPU search',()=>{
  it('searches NVIDIA capabilities without a model-name allowlist and preserves shared-memory hosts',async()=>{
    const requests:any[]=[];
    const client=new VastClient(async()=>'fixture-key',async(_input,init)=>{
      const query=JSON.parse(String(init?.body));requests.push(query);
      return reply(query.gpu_name?.eq==='GB10'?[raw({id:2,ask_contract_id:2,machine_id:2,gpu_name:'GB10',gpu_ram:null,cpu_ram:128000,cpu_arch:'arm64',compute_cap:1210})]:[raw()]);
    });
    const rows=await client.offers(filters);
    expect(requests.find(query=>!query.gpu_name)).toMatchObject({gpu_ram:{gte:24000},gpu_arch:{eq:'nvidia'},compute_cap:{gte:800},inet_down:{gte:250},dph_total:{lte:.7},inet_down_cost:{lte:.005}});
    expect(rows.map(row=>row.gpu_name)).toEqual(['RTX 4500Ada','GB10']);
    expect(rows.map(row=>normalizeOffer(row,filters).compatible)).toEqual([true,true]);
  });
  it('follows provider truncation with the rental ask cursor and deduplicates overlaps',async()=>{
    const calls:any[]=[];
    const client=new VastClient(async()=>'fixture-key',async(_input,init)=>{
      const query=JSON.parse(String(init?.body));calls.push(query);
      return query.ask_contract_id?.gt===2?reply([raw({id:2,ask_contract_id:2}),raw({id:3,ask_contract_id:3})]):reply([raw(),raw({id:2,ask_contract_id:2})],true);
    });
    const rows=await client.offers({...filters,workflow:'clarity'});
    expect(rows.map(row=>row.ask_contract_id)).toEqual([1,2,3]);
    expect(calls).toHaveLength(2);expect(calls[1].ask_contract_id).toEqual({gt:2});
    expect(calls[0].cpu_arch).toEqual({in:['amd64']});
  });
  it('refuses to present a partial search when the provider does not advance its cursor',async()=>{
    const client=new VastClient(async()=>'fixture-key',async()=>reply([raw()],true));
    await expect(client.offers({...filters,workflow:'clarity'})).rejects.toThrow('incomplete ranking');
  });
  it('checks all selected limits again when normalizing provider rows',()=>{
    const strict={...filters,minVram:48,maxHourly:.4,maxDownloadPrice:.002,minDownload:1000};
    expect(normalizeOffer(raw({gpu_ram:49152}),strict).compatible).toBe(true);
    for(const values of [{gpu_ram:24576},{inet_down:999},{inet_down_cost:.003},{search:{gpuCostPerHour:.38,diskHour:.03,totalHour:.41}},{reliability2:.9},{compute_cap:750},{gpu_arch:'amd'},{gpu_name:'H100 MIG 1g'},{num_gpus:2},{gpu_ram:'unknown'},{cpu_ram:'unknown'},{direct_port_count:'unknown'}])expect(normalizeOffer(raw(values),strict).compatible).toBe(false);
    expect(normalizeOffer(raw({gpu_ram:49152,inet_down_cost:.002,search:{gpuCostPerHour:.38,diskHour:.02,totalHour:.4}}),strict).compatible).toBe(true);
    expect(normalizeOffer(raw({gpu_name:'Future NVIDIA model',compute_cap:1200}),filters).compatible).toBe(true);
  });
  it('prevents a previously selected or favourite quote from bypassing tighter filters',()=>{
    const quoted=offer(1);expect(offerMatchesFilters(quoted,filters)).toBe(true);
    for(const value of [{maxHourly:.31},{maxDownloadPrice:0},{minVram:48},{disk:96},{minDownload:2000},{minReliability:1}])expect(offerMatchesFilters(quoted,{...filters,...value})).toBe(false);
  });
});

describe('transparent GPU value scores',()=>{
  it('scores faster compute, network and cheaper rates higher without changing offers',()=>{
    const slow=offer(1,{dlperf:30,gpu_mem_bw:250,total_flops:10,inet_down:250,inet_down_cost:.005}),fast=offer(2);
    const original=JSON.stringify([slow,fast]),ranked=rankGpuOffers([slow,fast],filters);
    expect(ranked[0].id).toBe(2);expect(ranked[0].recommendation?.score).toBeGreaterThan(ranked[1].recommendation!.score);
    expect(JSON.stringify([slow,fast])).toBe(original);
    expect(Object.values(recommendationWeights).reduce((sum,value)=>sum+value,0)).toBe(100);
  });
  it('chooses three distinct machines and excludes missing compute ratings from recommendations',()=>{
    const ranked=rankGpuOffers([offer(1),offer(2,{machine_id:1}),offer(3),offer(4),offer(5,{dlperf:null})],filters);
    const picks=ranked.filter(offer=>offer.recommendation?.rank);
    expect(picks).toHaveLength(3);expect(new Set(picks.map(offer=>offer.machineId)).size).toBe(3);
    expect(ranked.find(offer=>offer.id===5)?.recommendation).toMatchObject({rank:null,confidence:'limited'});
    expect(rankGpuOffers([offer(6,{dlperf:null,gpu_mem_bw:null})],filters)[0].recommendation?.rank).toBeNull();
    expect(rankGpuOffers([],filters)).toEqual([]);
  });
  it('caps VRAM credit and uses Mbps plus disk limits for transfer estimates',()=>{
    const a=offer(1,{gpu_ram:98304,inet_down:8000,disk_bw:100}),b=offer(2,{gpu_ram:196608,inet_down:8000,disk_bw:100});
    const ranked=rankGpuOffers([a,b],filters);
    expect(ranked[0].recommendation?.components.memory).toBe(10);expect(ranked[1].recommendation?.components.memory).toBe(10);
    expect(ranked[0].recommendation?.transferSeconds).toBe(300);
    expect(ranked[0].recommendation?.firstHourCost).toBeCloseTo(.35);
    expect(ranked[0].recommendation?.transferComputeCost).toBeCloseTo(.32/12);
    for(const value of ranked)expect(value.recommendation!.score).toBeGreaterThanOrEqual(0);
  });
});

describe('workflow floors and retained hardware',()=>{
  let root='',store:Store|undefined;
  afterEach(async()=>{store?.close();store=undefined;if(root)await rm(root,{recursive:true,force:true});root='';vi.restoreAllMocks();});
  it('reserves disk for only the chosen workflow and leaves generation drafts unchanged',async()=>{
    root=await mkdtemp(path.join(os.tmpdir(),'gpu-market-'));store=new Store(root);
    const before=JSON.stringify([store.draft(),store.imageDraft()]);
    const motion=marketRequirements(store,filters),image=marketRequirements(store,{...filters,workflow:'imagen'}),all=marketRequirements(store,{...filters,workflow:'all',disk:64});
    expect(motion.requirements.minVram).toBe(24);expect(motion.requirements.modelGB).toBeGreaterThan(0);
    expect(all.requirements.modelGB).toBeGreaterThanOrEqual(Math.max(motion.requirements.modelGB,image.requirements.modelGB));
    expect(all.filters.disk).toBeGreaterThanOrEqual(96);expect(all.filters.ram).toBe(64);expect(all.requirements.architectures).toEqual(['amd64']);
    expect(JSON.stringify([store.draft(),store.imageDraft()])).toBe(before);
  });
  it('retains full offer specs on a paused instance and prefers new provider readings',async()=>{
    root=await mkdtemp(path.join(os.tmpdir(),'gpu-market-'));store=new Store(root);
    const cloud=new CloudManager(store,{status:{state:'offline'}}as any,{}as any,process.cwd(),{backgroundSafety:false});
    try{
      const saved=offer(1);cloud.state.launches.push({instanceId:100,label:'fixture',offer:saved}as any);
      const before=JSON.stringify(saved),value=cloud.normalizeInstance({id:100,label:'fixture',gpu_name:saved.gpu,actual_status:'exited',intended_status:'stopped',disk_space:80,gpu_mem_bw:1020});
      expect(value.hardware).toMatchObject({cpu:'Fixture CPU',dlperf:120,memoryBandwidth:1020,downloadMbps:1000,downloadPerGB:.001,pcie:24,driver:'595.84'});
      expect(value.vram).toBe(24);expect(value.computeStopped).toBe(true);expect(value.managed).toBe(true);expect(JSON.stringify(saved)).toBe(before);
      const html=renderToStaticMarkup(<GpuHardwareDetails hardware={value.hardware!}/>);
      for(const name of ['GPU memory bandwidth','DLPerf rating','Download charge','Driver / CUDA','Fixture CPU'])expect(html).toContain(name);
    }finally{cloud.dispose();}
  });
  it('renders hardware filters, top picks and cost-aware cards without model-name chips',()=>{
    const offers=rankGpuOffers([offer(1),offer(2),offer(3)],filters);
    const html=renderToStaticMarkup(<GpuMarketplace filters={filters} onChange={()=>{}} offers={offers} selected={null} select={()=>{}} searching={false} searched searchError="" searchedAt={null} refresh={()=>{}} details={<aside>Hardware review</aside>}/>);
    for(const name of ['Minimum GPU VRAM','Maximum total hourly price','Minimum download speed','Top GPU recommendations','Memory bandwidth','Downloads','Review RTX 4500Ada'])expect(html).toContain(name);
    expect(html).not.toContain('gpu-family-filter');expect(html).not.toContain('Datacenter GPU model');
  });
});
