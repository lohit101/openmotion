import type {GpuOffer,OfferFilters} from './cloud';
import {DOWNLOAD_PRICE_CEILING} from './cloud';

export const recommendationWeights={compute:35,value:25,setup:20,memory:10,transfer:5,reliability:5} as const;
const positive=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const unit=(value:number)=>Math.max(0,Math.min(1,value));
const round=(value:number)=>Math.round(value*10)/10;

/** A transparent offer-rating heuristic, not a model-specific latency benchmark. */
export function rankGpuOffers(offers:GpuOffer[],filters:OfferFilters):GpuOffer[]{
  const eligible=offers.filter(offer=>offer.compatible);
  const best=(get:(offer:GpuOffer)=>number|null|undefined)=>Math.max(0,...eligible.map(offer=>get(offer)).filter(positive));
  const maxDlperf=best(offer=>offer.dlperf),maxBandwidth=best(offer=>offer.memoryBandwidth),maxFlops=best(offer=>offer.tflops);
  const speed=(value:number|null|undefined,max:number)=>positive(value)&&max>0?Math.sqrt(unit(value/max)):0;
  const throughput=(offer:GpuOffer)=>Math.min(offer.downloadMbps/8,positive(offer.diskBandwidth)?offer.diskBandwidth:Infinity);
  const maxNetwork=best(throughput);
  const costs=eligible.map(offer=>offer.totalHourly).filter(positive),cheapest=costs.length?Math.min(...costs):0;
  const scored=eligible.map(offer=>{
    const linear=(value:number|null|undefined,max:number)=>positive(value)&&max>0?unit(value/max):0;
    const compute=.65*linear(offer.dlperf,maxDlperf)+.25*linear(offer.memoryBandwidth,maxBandwidth)+.1*linear(offer.tflops,maxFlops);
    const value=positive(offer.totalHourly)?Math.sqrt(unit(cheapest/offer.totalHourly)):0;
    const setup=speed(throughput(offer),maxNetwork),memory=unit((offer.vram*1024/1000)/Math.max(24,filters.minVram)/2);
    const transfer=offer.downloadPerGB===null?0:1-unit(offer.downloadPerGB/DOWNLOAD_PRICE_CEILING);
    const reliability=unit((offer.reliability-.9)/.1);
    const components={compute:round(compute*35),value:round(value*25),setup:round(setup*20),memory:round(memory*10),transfer:round(transfer*5),reliability:round(reliability*5)};
    const transferSeconds=positive(throughput(offer))&&positive(offer.modelDownloadGB)?offer.modelDownloadGB*1000/throughput(offer):null;
    return {...offer,recommendation:{score:round(Object.values(components).reduce((sum,value)=>sum+value,0)),rank:null as number|null,
      confidence:positive(offer.dlperf)&&positive(offer.memoryBandwidth)?'rated' as const:'limited' as const,components,transferSeconds,
      transferComputeCost:transferSeconds!==null&&offer.totalHourly!==null?transferSeconds/3600*offer.totalHourly:null,
      firstHourCost:offer.totalHourly!==null&&offer.modelDownloadCost!==null?offer.totalHourly+offer.modelDownloadCost:null}};
  }).sort((a,b)=>b.recommendation.score-a.recommendation.score||(a.totalHourly??Infinity)-(b.totalHourly??Infinity)||a.id-b.id);
  // One recommendation per physical machine, even if Vast exposes several asks.
  const machines=new Set<number>();let rank=0;
  for(const offer of scored)if(offer.recommendation.confidence==='rated'&&!machines.has(offer.machineId)&&rank<3){machines.add(offer.machineId);offer.recommendation.rank=++rank;}
  return scored;
}
