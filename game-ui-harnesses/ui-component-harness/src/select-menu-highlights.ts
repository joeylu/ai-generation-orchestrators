import type {Issue} from './contract.ts';
export interface SelectMenuHighlight {
  color: string;
  alpha: number;
  insets: {top:number;right:number;bottom:number;left:number};
  cornerRadius: number;
}
/** Equal-height popup content rows; selected wins over hover, never stacked. */
export interface SelectMenuHighlights {
  version: '1.0';
  coordinateSpace: 'popup-row-local';
  selected: SelectMenuHighlight;
  hover: SelectMenuHighlight;
}
export function validateSelectMenuHighlights(value:unknown, content:unknown, count:number, path:string):Issue[]{
  const issues:Issue[]=[];
  const fail=(p:string,code:string,message:string)=>issues.push({path:p,code,message});
  const object=(v:unknown,p:string,keys:string[]):Record<string,unknown>|undefined=>{
    if(!v||typeof v!=='object'||Array.isArray(v)){fail(p,'OBJECT_REQUIRED','must be an object');return;}
    const o=v as Record<string,unknown>;
    for(const k of keys)if(!Object.hasOwn(o,k))fail(p+'.'+k,'REQUIRED_FIELD','field is required');
    for(const k of Object.keys(o))if(!keys.includes(k))fail(p+'.'+k,'UNKNOWN_FIELD','unsupported field');
    return o;
  };
  const data=object(value,path,['version','coordinateSpace','selected','hover']);if(!data)return issues;
  if(data.version!=='1.0')fail(path+'.version','UNSUPPORTED_VERSION','only 1.0 is supported');
  if(data.coordinateSpace!=='popup-row-local')fail(path+'.coordinateSpace','UNSUPPORTED_COORDINATE_SPACE','must be popup-row-local');
  const safe=content as {width:number;height:number}|undefined;
  const valid=!!safe&&[safe.width,safe.height,count].every(n=>Number.isFinite(n)&&n>0);
  if(!valid)fail(path,'POPUP_CONTENT_REQUIRED','menuHighlights requires explicit valid popupContentLayout and nonempty options');
  for(const name of ['selected','hover']){
    const p=path+'.'+name,state=object(data[name],p,['color','alpha','insets','cornerRadius']);if(!state)continue;
    if(typeof state.color!=='string'||!/^#[0-9a-fA-F]{6}$/.test(state.color))fail(p+'.color','INVALID_COLOR','must be #RRGGBB');
    if(typeof state.alpha!=='number'||!Number.isFinite(state.alpha)||state.alpha<0||state.alpha>1)fail(p+'.alpha','INVALID_ALPHA','must be finite in [0,1]');
    const inset=object(state.insets,p+'.insets',['top','right','bottom','left']);
    const nonnegative=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
    if(!nonnegative(state.cornerRadius))fail(p+'.cornerRadius','INVALID_RADIUS','must be finite and nonnegative');
    if(inset){
      for(const key of ['top','right','bottom','left'])if(!nonnegative(inset[key]))fail(p+'.insets.'+key,'INVALID_INSET','must be finite and nonnegative');
      if(valid&&Object.values(inset).every(nonnegative)){
        const width=safe!.width-(inset.left as number)-(inset.right as number),height=safe!.height/count-(inset.top as number)-(inset.bottom as number);
        if(width<=0||height<=0)fail(p+'.insets','HIGHLIGHT_OUT_OF_BOUNDS','insets must leave a positive rectangle inside each content row');
        else if(nonnegative(state.cornerRadius)&&(state.cornerRadius as number)>Math.min(width,height)/2)fail(p+'.cornerRadius','RADIUS_OUT_OF_BOUNDS','radius must not exceed half of the smaller inset dimension');
      }
    }
  }
  return issues;
}
export function scaleSelectMenuHighlights(value:SelectMenuHighlights,scale:number):SelectMenuHighlights{
  const part=(v:SelectMenuHighlight):SelectMenuHighlight=>({...v,insets:{top:v.insets.top*scale,right:v.insets.right*scale,bottom:v.insets.bottom*scale,left:v.insets.left*scale},cornerRadius:v.cornerRadius*scale});
  return {...value,selected:part(value.selected),hover:part(value.hover)};
}
