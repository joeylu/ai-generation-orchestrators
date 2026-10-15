const workFile=p=>typeof p==='string'&&/^work\/(?:[A-Za-z0-9_-]+\/)+[A-Za-z0-9_.-]+$/.test(p);
const digest=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
// Locate exact original contract bytes within a verified task input inventory.
export function frozenContractPaths(inputs,bindings){
  return Object.fromEntries(['registry','usage','template'].map(key=>{
    const input=inputs.find(f=>digest(f.sha256)&&f.sha256===bindings[key+'Sha256']&&workFile(f.file)&&f.file.endsWith('/inputs/'+key+'.json'));
    if(!input)throw Error('COMPONENT_UPGRADE_CONTRACTS');
    return [key,input.file];
  }));
}
