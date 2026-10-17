// Local editor state only. These keys are not artifact digests or save tokens.
const invalid=()=>{throw new TypeError('编辑器状态必须是有限的 JSON 数据。');};
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
function canonical(value,active=new Set(),omitRevision=false){
  if(value===null||typeof value==='string'||typeof value==='boolean')return value;
  if(typeof value==='number')return Number.isFinite(value)?value:invalid();
  if(!Array.isArray(value)&&!plain(value)||active.has(value))return invalid();
  active.add(value);
  try{
    if(Array.isArray(value))return Array.from(value,item=>canonical(item,active));
    return Object.fromEntries(Object.keys(value).filter(key=>!omitRevision||key!=='revision').sort().map(key=>[key,canonical(value[key],active)]));
  }finally{active.delete(value);}
}
const clone=value=>structuredClone(canonical(value));
const key=value=>{if(typeof value!=='string'||!value.length)throw new TypeError('草稿需要版本和节点标识。');return value;};

/** Compare authored content while session undo/redo advances only its revision. */
export function panelDocumentFingerprint(document){
  if(!plain(document))return invalid();
  return JSON.stringify(canonical(document,new Set(),true));
}

/** Raw unapplied form values. Each read/write boundary owns an independent copy. */
export function createPanelEditorDraftStore(){
  const variants=new Map();
  const store={
    set(variantKey,nodeId,values){
      key(variantKey);key(nodeId);const value=clone(values);
      let nodes=variants.get(variantKey);if(!nodes){nodes=new Map();variants.set(variantKey,nodes);}
      nodes.set(nodeId,value);return store;
    },
    get(variantKey,nodeId){
      const nodes=variants.get(key(variantKey));key(nodeId);
      return nodes?.has(nodeId)?clone(nodes.get(nodeId)):undefined;
    },
    delete(variantKey,nodeId){
      const nodes=variants.get(key(variantKey));key(nodeId);if(!nodes)return false;
      const removed=nodes.delete(nodeId);if(!nodes.size)variants.delete(variantKey);return removed;
    },
    clear(variantKey){if(variantKey===undefined)variants.clear();else variants.delete(key(variantKey));},
    entries(variantKey){
      if(variantKey!==undefined)key(variantKey);
      return [...variants].flatMap(([variant,nodes])=>variantKey!==undefined&&variant!==variantKey?[]:[...nodes].map(([nodeId,values])=>({variantKey:variant,nodeId,values:clone(values)})));
    },
    get size(){let size=0;for(const nodes of variants.values())size+=nodes.size;return size;},
  };
  return store;
}
