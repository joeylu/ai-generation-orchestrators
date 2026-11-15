// Brush definitions are host data. Supported behaviors are explicitly registered here.
const handlers=Object.freeze({
  terrain:Object.freeze({tool:'paint',stroke:(brush,cells)=>({type:'paint-cells',familyId:brush.familyId,cells})}),
});
export const findBrush=(brushes,id)=>brushes.find(brush=>brush.brushId===id)??null;
export const brushTool=brush=>handlers[brush?.kind]?.tool;
export const brushStroke=(brush,cells)=>handlers[brush?.kind]?.stroke(brush,cells)??null;
