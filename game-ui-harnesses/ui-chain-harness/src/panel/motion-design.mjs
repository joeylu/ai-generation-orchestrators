// Chain's authored action recipes. Upstream supplies the scheduler and legacy
// tokens; this is the single versioned source for the more distinct presentation.
export const MOTION_DESIGN_VERSION='2.1';
const designs={
 playful:{pressScale:.9,pressMs:65,releasePeak:1.08,releasePeakMs:95,releaseSettleMs:150,hoverScale:1.04,hoverMs:120,enterMs:340,exitMs:170,enterScale:.78,enterOffsetY:0,changeMs:260,staggerMs:45,focusMs:260,scrollMs:220,easing:'spring',recipe:{kind:'pop',rowOffset:12,tabOffset:18,dialogOffset:0,buttonOffset:0,staticOffset:12,markOffset:0,focusStart:.15,thumbLift:3,valueEasing:'ease-out'}},
 premium:{pressScale:.985,pressMs:100,releasePeak:1,releasePeakMs:220,releaseSettleMs:0,hoverScale:1.015,hoverMs:220,enterMs:420,exitMs:240,enterScale:1,enterOffsetY:0,changeMs:360,staggerMs:65,focusMs:360,scrollMs:300,easing:'ease-in-out',recipe:{kind:'layered',rowOffset:0,tabOffset:0,dialogOffset:0,buttonOffset:0,staticOffset:0,markOffset:0,focusStart:.1,thumbLift:2,valueEasing:'ease-in-out'}},
 corporate:{pressScale:1,pressMs:55,releasePeak:1,releasePeakMs:100,releaseSettleMs:0,hoverScale:1,hoverMs:90,enterMs:200,exitMs:140,enterScale:1,enterOffsetY:24,changeMs:170,staggerMs:0,focusMs:90,scrollMs:140,easing:'ease-out',recipe:{kind:'slide',rowOffset:14,tabOffset:48,dialogOffset:36,buttonOffset:3,staticOffset:24,markOffset:4,focusStart:.65,thumbLift:1,valueEasing:'linear'}},
};
export function motionDesign(style){const value=designs[style];if(!value)throw Error('MOTION_DESIGN_STYLE_INVALID');return structuredClone(value);}
export const unit=value=>Math.max(0,Math.min(1,value));
export function phase(t,start=0,end=1){return unit((t-start)/(end-start));}
export function pop(t){return 1+(2.70158*(t-1)**3+1.70158*(t-1)**2);}
