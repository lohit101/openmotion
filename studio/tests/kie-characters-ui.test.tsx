import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import KieCharacters from '../src/KieCharacters';
import KieInputPreview from '../src/KieInputPreview';
import {kieDefaults} from '../shared/kie';
import {characterAdditionalReferences,characterSnapshot,type KieCharacterPack} from '../shared/kie-characters';
const face={id:'face',assetId:'face-asset',role:'face' as const,view:'front' as const,expression:'neutral' as const,label:'Neutral face',format:'single' as const,sha256:'a'.repeat(64)};
const back={...face,id:'back',assetId:'back-asset',role:'body' as const,view:'back' as const,label:'Back of head'};
const smile={...face,id:'smile',assetId:'smile-asset',role:'expression' as const,expression:'smile' as const,label:'Smile'};
const pack:KieCharacterPack={id:'saved-character',name:'Demo character',revision:1,createdAt:'2026-11-06',updatedAt:'2026-11-06',archived:false,faceId:face.id,references:[face,back,smile]};
it('opens the existing manual route safely when no character is selected',()=>{
 const html=renderToStaticMarkup(<KieCharacters packs={[pack]} assets={[]} draft={kieDefaults} change={()=>{}} added={()=>{}} saved={()=>{}} />);
 expect(html).toContain('aria-label="Character reference source"'); expect(html).toContain('Manage characters'); expect(html).not.toContain('Identity anchor');
 const empty=renderToStaticMarkup(<KieCharacters packs={[]} assets={[]} draft={kieDefaults} change={()=>{}} added={()=>{}} saved={()=>{}} />);
 expect(empty).toContain('aria-label="Character reference source"');
});
it('previews the frozen identity anchor, selectable views and exact full prompt',()=>{
 const snapshot=characterSnapshot(pack,[smile.id,back.id]),draft={...kieDefaults,sourceId:'source',referenceId:'scene',faceReferenceId:face.assetId,additionalReferences:characterAdditionalReferences(snapshot),characterPack:snapshot,prompt:'Keep the scene.'};
 const html=renderToStaticMarkup(<KieCharacters packs={[pack]} assets={[]} draft={draft} change={()=>{}} added={()=>{}} saved={()=>{}} />);
 for(const text of ['Image2 · Identity anchor','Image3 · Smile','Image4 · Back of head','Revision 1','Angles + expressions','Whole sheets'])expect(html).toContain(text);
 const preview=renderToStaticMarkup(<KieInputPreview draft={draft} assets={[]} />);
 for(const text of ['4/10 images','Image1 · Character, outfit &amp; scene','Image2 · Facial identity','Image3 · Smile','Image4 · Back of head','Keep the scene.'])expect(preview).toContain(text);
 expect(preview).toContain('Expression images are appearance examples, not timed keyframes.');
});
it('retains a historical character selection without silently adopting an updated revision',()=>{
 const snapshot=characterSnapshot(pack,[back.id]),draft={...kieDefaults,faceReferenceId:face.assetId,additionalReferences:characterAdditionalReferences(snapshot),characterPack:snapshot};
 const html=renderToStaticMarkup(<KieCharacters packs={[{...pack,name:'Updated',revision:2}]} assets={[]} draft={draft} change={()=>{}} added={()=>{}} saved={()=>{}} />);
 expect(html).toContain('saved revision');expect(html).toContain('Load latest revision');expect(html).toContain('Image3 · Back of head');
});
