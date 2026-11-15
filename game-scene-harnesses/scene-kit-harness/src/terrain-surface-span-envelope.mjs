import {check,exact,seal,unseal,digest} from './generation/common.mjs';
import {canonicalJson} from './document.mjs';

export const TERRAIN_SURFACE_SPAN_PROFILE='native-lip-continuous-span-coverage-v1';
const EPS=1e-7,q=n=>Math.round(n*1e12)/1e12;
export function validateTerrainSurfaceSpanEnvelope(value,end,fade,height){
  exact(value,['shortWidthWorld','fullWidthWorld','capEndRow','fadeRows']);
  check(Number.isFinite(value.shortWidthWorld)&&value.shortWidthWorld>=1&&value.shortWidthWorld<=4096
    &&Number.isFinite(value.fullWidthWorld)&&value.fullWidthWorld>value.shortWidthWorld&&value.fullWidthWorld<=4096
    &&Number.isSafeInteger(value.capEndRow)&&value.capEndRow>=1&&value.capEndRow<=Math.min(end,height)
    &&Number.isSafeInteger(value.fadeRows)&&value.fadeRows>=0&&value.fadeRows<=value.capEndRow
    &&value.capEndRow-value.fadeRows<=end-fade,'TERRAIN_SURFACE_SPAN_ENVELOPE',
  'Short coverage must end no later and become translucent no later than the full source-bound interface');
  return value;
}

export function buildTerrainSurfaceSpanProfile(options,{appearance,surfaceInterface}){
  exact(surfaceInterface,['profile','capSourceSha256','capEndRow','fadeRows']);
  const height=appearance?.cap?.pixelSize?.height,end=surfaceInterface.capEndRow,fade=surfaceInterface.fadeRows;
  const depth=appearance?.capDepth?.numerator/appearance?.capDepth?.denominator,uv=appearance?.capUvEnd?.numerator/appearance?.capUvEnd?.denominator;
  check(surfaceInterface.profile==='world-body-native-lip-v1'&&surfaceInterface.capSourceSha256===appearance?.cap?.source?.sha256
    &&/^[a-f0-9]{64}$/.test(surfaceInterface.capSourceSha256)&&Number.isFinite(depth)&&depth>0&&depth<=128&&Number.isFinite(uv)&&uv>0&&uv<=1
    &&Number.isSafeInteger(height)&&height>=2&&height<=4096&&Number.isSafeInteger(end)&&end>=1&&end<=height
    &&Number.isSafeInteger(fade)&&fade>=0&&fade<=end,'TERRAIN_SURFACE_SPAN_BINDING');
  validateTerrainSurfaceSpanEnvelope(options,end,fade,height);
  return seal({format:'ai_scene_terrain_surface_span_envelope_v1',profile:TERRAIN_SURFACE_SPAN_PROFILE,
    capSourceSha256:appearance.cap.source.sha256,capMappingSha256:digest({cap:appearance.cap,capDepth:appearance.capDepth,capUvEnd:appearance.capUvEnd}),
    interfaceSha256:digest(surfaceInterface),options:{...options},coveragePolicy:'reduce-original-native-lip-only',
    sourcePngChanged:false,sourceCoordinatesWarped:false,generationCalls:0,visualAcceptance:'not-assessed'});
}

export function validateTerrainSurfaceSpanProfile(record,inputs){
  unseal(record);check(canonicalJson(record)===canonicalJson(buildTerrainSurfaceSpanProfile(record.options,inputs)),'TERRAIN_SURFACE_SPAN_REPLAY');return record;
}

export function terrainSurfaceSpanRows(width,envelope,capEndRow,fadeRows){
  check(Number.isFinite(width)&&width>0,'TERRAIN_SURFACE_SPAN_GEOMETRY');
  const t=Math.min(1,Math.max(0,(width-envelope.shortWidthWorld)/(envelope.fullWidthWorld-envelope.shortWidthWorld)));
  return {widthWorld:q(width),fullCoverageWeight:q(t),capEndRow:q(envelope.capEndRow+(capEndRow-envelope.capEndRow)*t),
    fadeRows:q(envelope.fadeRows+(fadeRows-envelope.fadeRows)*t)};
}

// Join only exposed top segments in one already connected solid group. No
// vertex moves; ambiguous branches fail rather than selecting a shorter path.
export function buildTerrainSurfaceSpanEnvelope(segments,{envelope,capEndRow,fadeRows}){
  check(Number.isSafeInteger(capEndRow)&&capEndRow>=1&&capEndRow<=4096&&Number.isSafeInteger(fadeRows)&&fadeRows>=0&&fadeRows<=capEndRow,'TERRAIN_SURFACE_SPAN_ENVELOPE');
  validateTerrainSurfaceSpanEnvelope(envelope,capEndRow,fadeRows,4096);
  check(Array.isArray(segments)&&segments.length>0&&segments.length<=16384,'TERRAIN_SURFACE_SPAN_BUDGET');
  const vertices=[],buckets=new Map(),starts=[],ends=[];let work=0;
  const consume=()=>{check(++work<=2097152,'TERRAIN_SURFACE_SPAN_BUDGET');};
  function vertex(p){
    check(p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Math.abs(p.x)<=16777216&&Math.abs(p.y)<=16777216,'TERRAIN_SURFACE_SPAN_GEOMETRY');
    const x=Math.floor(p.x/EPS),y=Math.floor(p.y/EPS),hits=[];
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
      consume();for(const id of buckets.get((x+dx)+','+(y+dy))??[]){consume();const v=vertices[id];if(Math.abs(v.x-p.x)<=EPS&&Math.abs(v.y-p.y)<=EPS)hits.push(id);}
    }
    check(hits.length<=1,'TERRAIN_SURFACE_SPAN_TOPOLOGY','Ambiguous endpoint tolerance neighborhood');
    if(hits.length)return hits[0];
    const id=vertices.length;vertices.push({x:p.x,y:p.y,incoming:null,outgoing:null});const key=x+','+y;
    if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(id);return id;
  }
  for(const [i,s]of segments.entries()){
    check(s?.a&&s?.b&&s.b.x-s.a.x>EPS,'TERRAIN_SURFACE_SPAN_GEOMETRY');
    const a=vertex(s.a),b=vertex(s.b);
    check(vertices[a].outgoing===null&&vertices[b].incoming===null,'TERRAIN_SURFACE_SPAN_TOPOLOGY','Exposed top must have one unambiguous successor and predecessor');
    vertices[a].outgoing=i;vertices[b].incoming=i;starts[i]=a;ends[i]=b;
  }
  const roots=segments.map((_,i)=>i).filter(i=>vertices[starts[i]].incoming===null).sort((a,b)=>segments[a].a.x-segments[b].a.x||segments[a].a.y-segments[b].a.y),
    selection=new Array(segments.length),spans=[];
  for(const root of roots){
    const ids=[];let i=root;
    while(i!==null){consume();check(selection[i]===undefined,'TERRAIN_SURFACE_SPAN_TOPOLOGY');ids.push(i);selection[i]=-1;i=vertices[ends[i]].outgoing;}
    const first=segments[ids[0]],last=segments[ids.at(-1)],width=last.b.x-first.a.x,
      row={spanId:spans.length,from:{...first.a},to:{...last.b},segmentCount:ids.length,...terrainSurfaceSpanRows(width,envelope,capEndRow,fadeRows)};
    spans.push(row);for(const id of ids)selection[id]=row;
  }
  check(selection.every(v=>v&&v!==-1),'TERRAIN_SURFACE_SPAN_TOPOLOGY');
  return {selection,spans,work,endpointToleranceWorld:EPS};
}
