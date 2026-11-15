import {check,exact} from './common.mjs';

// Feasibility of full-frame coverage and reviewer-supplied feature intervals.
// This is geometry only: it neither recognizes images nor checks source Alpha.
export function bandLayoutFeasibility(input) {
  exact(input,['sourceSize','coverage','scale','translation','features']);
  const finite=v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e7;
  const interval=(v,code)=>{check(Array.isArray(v)&&v.length===2&&v.every(finite)&&v[0]<=v[1],code);};
  exact(input.sourceSize,['width','height']);check(finite(input.sourceSize.width)&&finite(input.sourceSize.height)&&input.sourceSize.width>0&&input.sourceSize.height>0,'BAND_LAYOUT_SIZE');
  for(const value of [input.coverage,input.translation]){exact(value,['x','y']);interval(value.x,'BAND_LAYOUT_RANGE');interval(value.y,'BAND_LAYOUT_RANGE');}
  interval(input.scale,'BAND_LAYOUT_SCALE');check(input.scale[0]>0,'BAND_LAYOUT_SCALE');
  check(Array.isArray(input.features)&&input.features.length<=24,'BAND_LAYOUT_FEATURES');
  const axes={};
  for(const axis of ['x','y']){
    const size=input.sourceSize[axis==='x'?'width':'height'],c=input.coverage[axis],t=input.translation[axis];
    // Each line is a lower/upper bound on translation: a + b * scale.
    axes[axis]={lower:[[t[0],0],[c[1],-size]],upper:[[t[1],0],[c[0],0]]};
  }
  const names=new Set();
  for(const feature of input.features){
    exact(feature,['featureId','native','target']);check(typeof feature.featureId==='string'&&/^[a-zA-Z0-9._-]{1,80}$/.test(feature.featureId)&&!names.has(feature.featureId),'BAND_LAYOUT_FEATURES');names.add(feature.featureId);
    for(const v of [feature.native,feature.target]){exact(v,['x','y']);interval(v.x,'BAND_LAYOUT_FEATURE_RANGE');interval(v.y,'BAND_LAYOUT_FEATURE_RANGE');}
    for(const axis of ['x','y']){const n=feature.native[axis],target=feature.target[axis],size=input.sourceSize[axis==='x'?'width':'height'];
      check(n[0]>=0&&n[1]<=1,'BAND_LAYOUT_FEATURE_RANGE');
      axes[axis].lower.push([target[0],-size*n[0]]);axes[axis].upper.push([target[1],-size*n[1]]);
    }
  }
  let [lo,hi]=input.scale;
  for(const {lower,upper} of Object.values(axes))for(const [a,b] of lower)for(const [c,d] of upper){
    // a+b*s <= c+d*s, with one shared scale for both axes.
    const slope=b-d,intercept=c-a;
    if(slope===0){if(intercept<0)return {status:'infeasible',reason:'contradictory-translation-bounds'};}
    else if(slope>0)hi=Math.min(hi,intercept/slope);else lo=Math.max(lo,intercept/slope);
  }
  if(lo>hi)return {status:'infeasible',reason:'no-common-scale'};
  const s=lo+(hi-lo)/2,witness={scale:s};
  for(const axis of ['x','y']){const {lower,upper}=axes[axis],a=Math.max(...lower.map(([p,q])=>p+q*s)),b=Math.min(...upper.map(([p,q])=>p+q*s));witness[axis]=a+(b-a)/2;}
  return {status:'feasible',scaleInterval:[lo,hi],witness,coverageMeaning:'caller-supplied-full-frame-only',alpha:'not-assessed',visualAcceptance:'not-assessed'};
}
