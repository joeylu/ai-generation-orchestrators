const overlap=(a,b)=>a[0]<b[0]+b[2]&&b[0]<a[0]+a[2]&&a[1]<b[1]+b[3]&&b[1]<a[1]+a[3];
const slotWarnings=new Set(['substantial-crosses-slot','proposal-crosses-slot','foreign-component-in-slot']);
const fail=(reason,id)=>{const code='metadata.'+reason+': '+id;throw Object.assign(Error(code),{code});};

// Slots guide ownership; they are not crop boundaries. Keep their warnings as
// evidence, but only block unresolved ownership or actual crop collisions.
export function assertSeparatedCrops(parts){
  for(const p of parts){
    if(p.issues.includes('overlapping-proposals'))fail('overlap',p.assetId);
    if(!p.proposedCrop||p.conflictComponentIds.length||p.issues.some(i=>!slotWarnings.has(i)))fail('proposal-unresolved',p.assetId);
    for(const other of parts){
      if(other!==p&&other.proposedCrop&&overlap(p.proposedCrop,other.proposedCrop))fail('overlap',p.assetId);
    }
  }
}
