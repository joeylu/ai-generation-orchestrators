import {encodeRgbaPng} from '../../src/png.mjs';
import {seal,unseal} from '../../src/generation/common.mjs';

// An interior with continuous floor, two openings and an editable crate passing
// between a rear arcade and a near column. No canyon or floating platform.
export const galleryParts=[
 {id:'outside',role:'backdrop',parent:'far',z:10,box:[0,40,256,80],content:'Distant garden tree crowns and continuous lower garden ground visible through both openings; hidden garden continuation is design inference.',exclusions:['Painted sky','Gallery arch and near column','Crate, lamp and playable floor']},
 {id:'arcade',role:'scenery',parent:'middle',z:20,box:[0,0,256,120],content:'Fixed rear gallery arch, side piers and rear sill as one static open architectural frame; openings reveal the separately owned garden.',exclusions:['Near column','Sky and garden pixels inside openings','Crate, lamp and playable floor']},
 {id:'crate',role:'scenery',parent:'middle',z:30,box:[170,78,52,42],content:'One independently movable wooden crate; keep its complete silhouette including inferred portions hidden by the near column.',exclusions:['Near column and gallery frame','Garden and playable floor']},
 {id:'column',role:'scenery',parent:'middle',z:40,box:[196,16,20,104],content:'One near gallery column with its own compact foot, independently placed in front of the crate; never merge it with the rear arcade.',exclusions:['Rear arcade and distant garden','Crate and playable floor']},
 {id:'lamp',role:'scenery',parent:'middle',z:50,box:[123,20,12,45],content:'One hanging lamp and its short suspension chain, independently replaceable; it owns no ceiling pixels or cast light on other surfaces.',exclusions:['Gallery ceiling','Crate, column and garden']},
];
export function galleryRaster({lowerBacking=true}={}){
 const width=512,height=288,rgba=Buffer.alloc(width*height*4),rect=(x,y,w,h,c)=>{for(let py=y*2;py<(y+h)*2;py++)for(let px=x*2;px<(x+w)*2;px++)rgba.set([...c,255],(py*width+px)*4);};
 rect(0,0,256,144,[161,197,215]);
 rect(0,50,256,24,[98,141,112]);for(const x of [30,70,165,218])rect(x,40,16,32,[80,122,99]);
 if(lowerBacking){rect(0,74,256,46,[126,147,104]);rect(0,99,256,21,[167,159,125]);}
 rect(0,0,256,20,[126,109,92]);rect(0,20,18,100,[126,109,92]);rect(112,20,12,100,[126,109,92]);rect(238,20,18,100,[126,109,92]);rect(0,110,256,10,[117,98,82]);
 // Stepped arch shoulders keep the synthetic reference deterministic.
 for(const x of [18,124]){rect(x,20,12,10,[126,109,92]);rect(x+102,20,12,10,[126,109,92]);}
 rect(170,78,52,42,[178,112,67]);rect(174,82,44,4,[104,72,52]);rect(174,106,44,4,[104,72,52]);
 rect(200,16,12,104,[75,67,64]);rect(196,114,20,6,[75,67,64]);rect(128,20,2,28,[68,66,62]);rect(123,48,12,17,[231,185,79]);
 rect(0,120,256,24,[98,88,81]);rect(0,120,256,3,[161,143,119]);
 return {width,height,rgba,png:encodeRgbaPng(width,height,rgba)};
}
// Complete synthetic source returns, not reference crops. Each transparent part
// includes its own concealed continuation and excludes all neighboring paint.
export function gallerySourceRaster(id,{lowerBacking=true}={}){
 const width=520,height=296,rgba=Buffer.alloc(width*height*4);
 const rect=(x,y,w,h,c)=>{for(let py=y*2+4;py<(y+h)*2+4;py++)for(let px=x*2+4;px<(x+w)*2+4;px++)rgba.set([...c,255],(py*width+px)*4);};
 if(id==='sky'){
  for(let i=0;i<width*height;i++)rgba.set([161,197,215,255],i*4);
  rgba[0]=160; // Nonblank opaque fixture; interior probes remain exact.
 }else if(id==='outside'){
  rect(0,50,256,24,[98,141,112]);for(const x of [30,70,165,218])rect(x,40,16,32,[80,122,99]);
  if(lowerBacking){rect(0,74,256,46,[126,147,104]);rect(0,99,256,21,[167,159,125]);}
 }else if(id==='arcade'){
  rect(0,0,256,20,[126,109,92]);rect(0,20,18,100,[126,109,92]);rect(112,20,12,100,[126,109,92]);rect(238,20,18,100,[126,109,92]);rect(0,110,256,10,[117,98,82]);
  for(const x of [18,124]){rect(x,20,12,10,[126,109,92]);rect(x+102,20,12,10,[126,109,92]);}
 }else if(id==='crate'){
  rect(170,78,52,42,[178,112,67]);rect(174,82,44,4,[104,72,52]);rect(174,106,44,4,[104,72,52]);
 }else if(id==='column'){
  rect(200,16,12,104,[75,67,64]);rect(196,114,20,6,[75,67,64]);
 }else if(id==='lamp'){
  rect(128,20,2,28,[68,66,62]);rect(123,48,12,17,[231,185,79]);
 }else throw new Error('Unknown synthetic gallery owner');
 return {width,height,rgba,png:encodeRgbaPng(width,height,rgba)};
}
const galleryLayers=()=>[{layerId:'sky',kind:'background',zIndex:0,parallaxX:0},...galleryParts.map(p=>({layerId:p.id,kind:'environment',zIndex:p.z,parallaxX:p.id==='outside'?.2:1})),{layerId:'ground',kind:'terrain',zIndex:60,parallaxX:1}];
export function galleryBrief(base){return {...base,requirements:seal({...unseal(base.requirements),
 layers:galleryLayers(),
 subjects:[{subjectId:'sky',role:'sky',layerId:'sky',content:'Outdoor sky seen through the gallery openings',count:{min:1,max:1},placementHint:'wide'},...galleryParts.map(p=>({subjectId:p.id,role:p.role,layerId:p.id,content:p.content,count:{min:1,max:1},placementHint:'center'})),{subjectId:'ground',role:'ground',layerId:'ground',content:'Continuous gallery floor material; no architecture silhouettes or garden',count:{min:1,max:1},placementHint:'wide'}],
 compositionNotes:['Reference intent, independent edits and local occlusion; not exact contour reproduction. One continuous floor, no floating platforms.']})};}
export function galleryAnalysis(base){const box=([x,y,w,h])=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
 const rows=[{id:'sky',box:[0,0,256,144]},...galleryParts,{id:'ground',box:[0,120,256,24]}];
 return seal({...unseal(base),layers:galleryLayers(),
 instances:rows.map(p=>({instanceId:p.id+'.actual',subjectId:p.id,layerId:p.id,visibleEnvelope:box(p.box),anchor:{x:p.box[0],y:p.box[1]},visibility:'visible',anchorEvidence:'observed',notes:'Synthetic coarse region; concealed continuation is inferred, not measured.'})),
 surfaces:[{surfaceId:'ground.surface',instanceId:'ground.actual',points:[{x:0,y:120},{x:256,y:120}],evidence:'observed',notes:'Continuous horizontal gallery floor.'}]});}
export const galleryOverrides=galleryParts.map(p=>({subjectId:p.id,content:p.content,exclusions:p.exclusions,parentRole:p.parent,...(p.role==='scenery'?{groundingProfile:'scope-owned-support-v1'}:{}),framingProfile:'complete-silhouette-v1',sourceAppearance:{format:'ai_scene_source_appearance_v1',profile:'source-owned-appearance-v1',rules:['Preserve the reference local material colors and clear painted boundaries; no borrowed neighboring content.']}}));
export const galleryObservations={requiredObservationIds:['garden.upper','garden.lower',...galleryParts.filter(p=>p.id!=='outside').map(p=>p.id)],
 observations:[{observationId:'garden.upper',description:'Distant garden tree crowns',layerId:'outside',parentRole:'far'},{observationId:'garden.lower',description:'continuous lower garden ground visible through both openings',layerId:'outside',parentRole:'far'},...galleryParts.filter(p=>p.id!=='outside').map(p=>({observationId:p.id,description:p.content,layerId:p.id,parentRole:p.parent}))],
 assignments:[{observationId:'garden.upper',subjectId:'outside',scopeQuote:'Distant garden tree crowns'},{observationId:'garden.lower',subjectId:'outside',scopeQuote:'continuous lower garden ground visible through both openings'},...galleryParts.filter(p=>p.id!=='outside').map(p=>({observationId:p.id,subjectId:p.id,scopeQuote:p.content.slice(0,190)}))]};
