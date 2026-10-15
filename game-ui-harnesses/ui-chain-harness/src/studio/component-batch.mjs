// Four component sheets, optionally followed by the independently bound S05.
// Read-only status projection; compute and source integrity remain owned by intake.
export function receivedComponentBatch(state){
 const nodes=state?.nodes??[];
 const ids=nodes.map(n=>n.sheetId),expected=['S01','S02','S03','S04',...(nodes.length===5?['S05']:[])];
 return (nodes.length===4||nodes.length===5)&&new Set(ids).size===expected.length&&expected.every(id=>ids.includes(id))&&nodes.every(n=>n.status==='received');
}
import {hash,json} from '../skins/package.mjs';


// Effective plans can change under an explicitly confirmed single-sheet
// supplement while the original batch digest stays immutable.
export function receivedSourcesRevision(state){
 const nodes=state?.nodes??[],digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
 if(!nodes.length||nodes.some(n=>typeof n.sheetId!=='string'||!digest(n.planSha256)||!digest(n.rawSha256)))return null;
 const sources=nodes.map(({sheetId,planSha256,rawSha256})=>({sheetId,planSha256,rawSha256})).sort((a,b)=>a.sheetId.localeCompare(b.sheetId));
 return hash(json(sources));
}
