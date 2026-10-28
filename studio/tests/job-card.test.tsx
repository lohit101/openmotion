import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import JobCard from '../src/JobCard';
import { defaults, type Job } from '../shared/types';

const job={id:'card-test',title:'Test video',status:'running',settings:defaults,width:704,height:1248,segments:[],progress:{stage:'Propagate replacement through the source motion',node:'43',value:2,max:3,segment:1,segments:1,completedFrames:0,targetFrames:124}} as Job;
const render=(value:Job)=>renderToStaticMarkup(<JobCard job={value} onSelect={()=>undefined} onPatch={()=>undefined} onReuse={()=>undefined}/>);
it('keeps the long internal stage in hover/accessibility text while showing compact render progress',()=>{
  const html=render(job);expect(html).toContain('title="Propagate replacement through the source motion"');
  expect(html).toContain('>Rendering</span>');expect(html).toContain('role="progressbar"');expect(html).not.toContain('<span>Propagate replacement through the source motion</span>');
});
it('shows an attention state without a misleading active percentage for failures',()=>{
  const html=render({...job,status:'failed',error:'A saved segment needs recovery'});expect(html).toContain('>Failed</span>');expect(html).toContain('is-failed');expect(html).not.toContain('role="progressbar"');
});
it('keeps completed video playback available',()=>{
  const html=render({...job,status:'completed',output:'ready'});expect(html).toContain('<video');expect(html).not.toContain('job-pending');
});
