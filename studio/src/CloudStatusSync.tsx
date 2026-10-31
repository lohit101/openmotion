import {useEffect,useRef} from 'react';
import type {CloudState} from '../shared/cloud';
import {api} from './components';

/** Provider reads keep the header current in every workspace, including after wake. */
export default function CloudStatusSync({cloud,setCloud}:{cloud:CloudState;setCloud:(cloud:CloudState)=>void}){
  const latest=useRef(cloud);latest.current=cloud;
  const settling=cloud.busy||cloud.launches.some(launch=>['checking','requesting','waiting','installing','connecting','stopping','destroying'].includes(launch.phase)&&!launch.needsReconnect);
  useEffect(()=>{
    if(!cloud.configured)return;
    let disposed=false,pending=false;
    const refresh=async()=>{
      if(disposed||pending||document.hidden)return;
      pending=true;
      try{const value=await api<CloudState>('/cloud/refresh',{});if(!disposed)setCloud(value);}
      catch{if(!disposed)setCloud({...latest.current,error:'GPU status could not be refreshed. Open GPU cloud to retry.'});}
      finally{pending=false;}
    };
    void refresh();const timer=setInterval(()=>void refresh(),settling?3000:15000);
    const wake=()=>void refresh();window.addEventListener('focus',wake);window.addEventListener('online',wake);document.addEventListener('visibilitychange',wake);
    return()=>{disposed=true;clearInterval(timer);window.removeEventListener('focus',wake);window.removeEventListener('online',wake);document.removeEventListener('visibilitychange',wake);};
  },[cloud.configured,settling,setCloud]);
  return null;
}
