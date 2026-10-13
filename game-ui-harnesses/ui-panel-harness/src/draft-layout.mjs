import {validatePanelSpec} from './spec.mjs';
import {validateCatalog,resolveTheme} from './catalog.mjs';
import {compilePanel} from './compiler.mjs';
import {measureFlowLayout} from './flow-layout.mjs';
import {createPresentationPolicy} from './panel-presentation.mjs';
import {panelThemeTokens} from './menu-presentation.mjs';

const dimensions=['width','maxHeight','canvasWidth','canvasHeight'];
const fail=code=>{const error=new Error(code);error.code=code;throw error;};
/** Opt-in draft sizing. Caller explicitly identifies suggested dimensions; no NLP guessing.
 * Saved specs are immutable inputs. Business fields, styles, order and actions are never repaired.
 * Version 1 intentionally supports unframed, untabbed 0.16 flow panels without external assets.
 */
export function fitDraftPanelLayout(input,catalogInput,core,{mutableDimensions=[]}={}){
  const original=validatePanelSpec(input),catalog=validateCatalog(catalogInput);
  if(!Array.isArray(mutableDimensions)||new Set(mutableDimensions).size!==mutableDimensions.length||mutableDimensions.some(key=>!dimensions.includes(key)))fail('DRAFT_DIMENSION_POLICY');
  if(original.panelSpecVersion!=='0.16'||original.tabs||original.frame||original.assets)fail('DRAFT_LAYOUT_SCOPE');
  const mutable=new Set(mutableDimensions),theme=resolveTheme(catalog,original.theme);
  if(theme.visualStyle!=='modern-v3')fail('DRAFT_LAYOUT_SCOPE');
  const changes=[];
  for(let width=original.layout.width;width<=4096;width+=8){
    if(width!==original.layout.width&&!mutable.has('width'))break;
    const spec=structuredClone(original);spec.layout.width=width;
    if(mutable.has('canvasWidth'))spec.canvas.width=Math.min(4096,Math.max(original.canvas.width,width+64));
    if(width>spec.canvas.width)break;
    const policy=createPresentationPolicy(spec,panelThemeTokens(spec,theme),theme.presentationStyle,theme.surfaceStyle,theme.headingStyle,catalog);
    const probe=structuredClone(spec);probe.canvas.height=4096;probe.layout.maxHeight=4096;
    // Measure at the actual width, without a scroll gutter, before choosing suggested height.
    const natural=measureFlowLayout(probe,policy);
    if(mutable.has('maxHeight'))spec.layout.maxHeight=Math.max(spec.layout.maxHeight,Math.ceil(natural.panelHeight));
    if(mutable.has('canvasHeight'))spec.canvas.height=Math.min(4096,Math.max(spec.canvas.height,Math.ceil(natural.panelHeight)+64));
    let compiled;
    try{compiled=compilePanel(spec,catalog,core);}
    catch(error){if(error.code==='CONTROL_WIDTH'&&mutable.has('width'))continue;throw error;}
    const flatten=node=>[node,...(node.children??[]).flatMap(flatten)];
    const body=flatten(compiled.document.root).find(node=>node.id===spec.id+'.body');
    const scrollRemaining=body?.type==='ScrollView'&&body.props.contentHeight>body.layout.height;
    const values=value=>({width:value.layout.width,maxHeight:value.layout.maxHeight,canvasWidth:value.canvas.width,canvasHeight:value.canvas.height});
    const before=values(original),after=values(spec);
    for(const key of dimensions)if(before[key]!==after[key])changes.push({dimension:key,before:before[key],after:after[key]});
    return {spec:validatePanelSpec(spec),evidence:{policy:'draft-content-fit-v1',mutableDimensions:[...mutable],changes,
      status:scrollRemaining?'FIXED_DIMENSIONS_REQUIRE_SCROLL':'CONTENT_VISIBLE',scrollRemaining:Boolean(scrollRemaining),realModelCalls:0}};
  }
  fail('DRAFT_WIDTH_FIT_UNAVAILABLE');
}
