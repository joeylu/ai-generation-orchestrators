import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {galleryCandidate} from './helpers/gallery-candidate.mjs';
import {gallerySourceRaster} from './helpers/reference-gallery.mjs';
import {contextFor} from '../src/kit.mjs';
import {createEditor} from '../src/editor.mjs';
import {compileMap} from '../src/compile.mjs';
import {renderCoherentFrame} from '../src/coherent-render.mjs';
import {inspectPng} from '../src/png.mjs';
import {exportScene,openSceneExport} from '../src/persistence.mjs';
import {hash} from '../src/generation/common.mjs';

const pixel=(image,x,y)=>[...image.rgba.subarray((y*image.width+x)*4,(y*image.width+x)*4+4)];
const frame=(f,document=f.document)=>inspectPng(renderCoherentFrame(compileMap(f.handle,document),p=>contextFor(f.handle).files.get(p)),{includePixels:true});
const garden=[167,159,125,255],crate=[178,112,67,255],column=[75,67,64,255],sill=[117,98,82,255];

test('gallery ownership survives source derivation, compilation, independent edits and export reopen',t=>{
 const f=galleryCandidate(t),render=frame(f),editor=createEditor(f.handle,f.document),baseline=editor.getDocument();
 assert.equal(f.document.assemblyInstances.length,0);
 assert.deepEqual(pixel(render,70,104),garden); // Full lower opening has its own rear ground.
 assert.deepEqual(pixel(render,175,114),crate); // Crate is in front of the rear sill.
 assert.deepEqual(pixel(render,206,90),column); // Near column is in front of that crate.
 assert.deepEqual(pixel(render,197,116),column); // Full owned foot, not just narrow shaft.
 assert.equal(f.document.curveTerrains.length,1);
 assert.notDeepEqual(pixel(render,70,123),[161,197,215,255]); // The declared floor starts at 120, not the next grid row at 128.
 const raw=gallerySourceRaster('arcade');assert.equal(pixel(raw,70*2+4,104*2+4)[3],0);
 const hashes=new Map([...f.rawSources].map(([id,bytes])=>[id,hash(bytes)]));
 const moved=structuredClone(baseline);moved.instances.find(i=>i.instanceId==='crate.actual').x=120;
 editor.execute([{type:'move-instance',instanceId:'crate.actual',x:120,y:78}]);assert.deepEqual(editor.getDocument(),moved);
 const exposed=frame(f,editor.getDocument());assert.deepEqual(pixel(exposed,175,114),sill);assert.deepEqual(pixel(exposed,206,90),column);
 editor.undo();assert.deepEqual(editor.getDocument(),baseline);
 editor.execute([{type:'remove-instance',instanceId:'column.actual'}]);assert.deepEqual(pixel(frame(f,editor.getDocument()),206,90),crate);
 editor.undo();assert.deepEqual(editor.getDocument(),baseline);
 const wrong=structuredClone(f.document);wrong.layers.find(l=>l.layerId==='column').zIndex=25;
 assert.deepEqual(pixel(frame(f,wrong),206,90),crate); // The wrong order passes structural compilation, not this relation check.
 const out=join(f.parent,'export');exportScene(f.handle,f.document,out);
 const reopened=openSceneExport(out);assert.equal(reopened.compiled.source.authorSha256,compileMap(f.handle,f.document).source.authorSha256);
 for(const [id,bytes]of f.rawSources)assert.equal(hash(bytes),hashes.get(id));
});

test('a technically valid source with missing lower backing fails the explicit gallery visual relation',t=>{
 const f=galleryCandidate(t,{lowerBacking:false});
 // Coverage checks reviewed text, and PNG QA checks pixels/Alpha structure;
 // neither claims to recognize the missing garden. This analytic fixture does.
 assert.equal(f.coverage.status,'pass');assert.equal(f.coverage.semanticCorrectness,'not-assessed');
 assert.notDeepEqual(pixel(frame(f),70,104),garden);
});
