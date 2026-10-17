// Shared by initial construction, resize, and edit text-capacity checks.
export const radioItemWidth=(width,count,gap,direction)=>direction==='row'?(width-Math.max(0,count-1)*gap)/Math.max(1,count):width;
export const selectLabelWidth=(width,insets,indicatorWidth,gap)=>width-insets.left-insets.right-2*(indicatorWidth+gap);
