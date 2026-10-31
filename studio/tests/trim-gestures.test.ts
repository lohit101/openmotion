import {expect,it} from 'vitest';
import {trimEdgeTravel,trimTimelineClip,type EditorSource,type TimelineClip} from '../shared/clip-editor';

it('can recover trimmed-away source frames while holding at a viewport edge',()=>{
  const source={fps:24,frames:1920} as EditorSource;
  const clip={id:'trim',jobId:'video',inFrame:720,outFrame:960} as TimelineClip,zoom=48;
  const left=100,right=700;
  // A normal drag has already hit the left edge of the visible timeline,
  // while most of the original thirty seconds are still outside the viewport.
  const from=left+24,to=left-8;
  expect(trimTimelineClip(clip,'in',clip.inFrame+(to-from)/zoom*source.fps,source).inFrame).toBeGreaterThan(0);
  let travel=0;
  for(let frame=0;frame<720;frame++)travel+=trimEdgeTravel(from,to,left,right,1/60);
  expect(trimTimelineClip(clip,'in',clip.inFrame+(to-from+travel)/zoom*source.fps,source)).toMatchObject({inFrame:0,outFrame:960});
  travel=0;
  for(let frame=0;frame<720;frame++)travel+=trimEdgeTravel(right-24,right+8,left,right,1/60);
  expect(trimTimelineClip(clip,'out',clip.outFrame+(32+travel)/zoom*source.fps,source)).toMatchObject({inFrame:720,outFrame:1920});
  expect(clip).toMatchObject({inFrame:720,outFrame:960});
});

it('requires an intentional edge drag and bounds extension after a scheduling stall',()=>{
  expect(trimEdgeTravel(110,110,100,700,1)).toBe(0);
  expect(trimEdgeTravel(400,500,100,700,1)).toBe(0);
  expect(trimEdgeTravel(400,110,100,700,.02)).toBeLessThan(0);
  expect(trimEdgeTravel(400,690,100,700,.02)).toBeGreaterThan(0);
  expect(Math.abs(trimEdgeTravel(400,-1000,100,700,100))).toBeLessThanOrEqual(12);
  expect(trimEdgeTravel(400,690,100,100,.02)).toBe(0);
  expect(trimEdgeTravel(400,NaN,100,700,.02)).toBe(0);
});
