// Keep raw input values for editing; compare their meaning with the applied form.
// HTML inputs normalize line endings. Equality uses the displayed form so a
// focus/blur or style-only edit never rewrites untouched frozen source text.
export function panelTextInputValue(value,multiline){return multiline?String(value).replace(/\r\n?/g,'\n'):String(value).replace(/[\r\n]/g,'');}
export function panelFormDraft(values, baseline) {
 const draft={};
 const numericEqual=(a,b)=>String(a).trim()!==''&&Number.isFinite(Number(a))&&Math.abs(Number(a)-Number(b))<=.005;
 if(baseline.rect&&Object.keys(baseline.rect).some(key=>!numericEqual(values.rect?.[key],baseline.rect[key])))draft.rect=structuredClone(values.rect);
 if(baseline.text){
  const a=values.text,b=baseline.text;
  if(a&&(Object.keys(b.fields).some(key=>a.fields[key]!==b.fields[key])||a.fontDefault!==b.fontDefault||!a.fontDefault&&(String(a.fontSize).trim()===''||Number(a.fontSize)!==Number(b.fontSize))||a.colorDefault!==b.colorDefault||!a.colorDefault&&a.textColor.toLowerCase()!==b.textColor.toLowerCase()))draft.text=structuredClone(a);
 }
 return draft;
}
