/** Vertical-only source-pixel slicing; independent of registered track insets. */
export interface ScrollbarThumbSlices {version:'1.0';coordinateSpace:'thumb-source-pixels';top:number;bottom:number}
export function scrollbarThumbSlicesError(value:unknown,height:number,hasInsets:boolean):string|undefined{
 if(!hasInsets)return 'scrollbarInsets required to guarantee a valid minimum thumb size';
 if(!value||typeof value!=='object'||Array.isArray(value))return 'object required';
 const v=value as Record<string,unknown>;
 if(Object.keys(v).sort().join(',')!=='bottom,coordinateSpace,top,version'||v.version!=='1.0'||v.coordinateSpace!=='thumb-source-pixels')return 'unsupported fields, version or coordinate space';
 if(typeof v.top!=='number'||typeof v.bottom!=='number'||!Number.isInteger(v.top)||!Number.isInteger(v.bottom)||v.top<0||v.bottom<0)return 'nonnegative integer source pixels required';
 if(!Number.isFinite(height)||height<=0||v.top+v.bottom>=height)return 'slice caps must leave a positive source middle';
}
