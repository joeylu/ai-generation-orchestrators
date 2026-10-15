import {validatePanelSpec} from './spec.mjs';
import {validateCatalog,resolveTheme} from './catalog.mjs';
import {compilePanel} from './compiler.mjs';
import {measureFlowLayout,measureTabbedLayout} from './flow-layout.mjs';
import {createPresentationPolicy} from './panel-presentation.mjs';
import {panelThemeTokens} from './menu-presentation.mjs';
import {isReadableGameTheme} from './readable-game.mjs';

const dimensions=['width','maxHeight','canvasWidth','canvasHeight'];
const fail=code=>{const error=new Error(code);error.code=code;throw error;};
/** Opt-in draft sizing. Caller explicitly identifies suggested dimensions; no NLP guessing.
 * Saved specs are immutable inputs. Business fields, styles, order and actions are never repaired.
 * Version 1 supports unframed, untabbed 0.16 flow panels without external assets.
 * Explicit version 2 also measures every tab page and pinned content images;
 * internal List scrolling and the verified asset closure are retained.
 */
export function fitDraftPanelLayout(input,catalogInput,core,{mutableDimensions=[],policy='draft-content-fit-v1',assetClosure}={}){
  const original=validatePanelSpec(input),catalog=validateCatalog(catalogInput);
  if(!['draft-content-fit-v1','draft-content-fit-v2'].includes(policy))fail('DRAFT_LAYOUT_POLICY');
  if(!Array.isArray(mutableDimensions)||new Set(mutableDimensions).size!==mutableDimensions.length||mutableDimensions.some(key=>!dimensions.includes(key)))fail('DRAFT_DIMENSION_POLICY');
  if(original.panelSpecVersion!=='0.16'||(original.tabs&&policy==='draft-content-fit-v1')||original.frame
    ||(original.assets&&(policy==='draft-content-fit-v1'||original.assets.panelSurface!==null||original.assets.rowIcons.length)))fail('DRAFT_LAYOUT_SCOPE');
  const mutable=new Set(mutableDimensions),theme=resolveTheme(catalog,original.theme);
  if(theme.visualStyle!=='modern-v3')fail('DRAFT_LAYOUT_SCOPE');
  const changes=[];
  for(let width=original.layout.width;width<=4096;width+=8){
    if(width!==original.layout.width&&!mutable.has('width'))break;
    const spec=structuredClone(original);spec.layout.width=width;
    if(mutable.has('canvasWidth'))spec.canvas.width=Math.min(4096,Math.max(original.canvas.width,width+(isReadableGameTheme(theme)?32:64)));
    if(width>spec.canvas.width)break;
    const presentation=createPresentationPolicy(spec,panelThemeTokens(spec,theme),theme.presentationStyle,theme.surfaceStyle,theme.headingStyle,catalog);
    const probe=structuredClone(spec);probe.canvas.height=4096;probe.layout.maxHeight=4096;
    // Measure at the actual width, without a scroll gutter, before choosing suggested height.
    const natural=(spec.tabs?measureTabbedLayout:measureFlowLayout)(probe,presentation);
    if(mutable.has('maxHeight'))spec.layout.maxHeight=Math.max(spec.layout.maxHeight,Math.ceil(natural.panelHeight));
    if(mutable.has('canvasHeight'))spec.canvas.height=Math.min(4096,Math.max(spec.canvas.height,Math.ceil(natural.panelHeight)+64));
    let compiled;
    try{compiled=compilePanel(spec,catalog,core,undefined,assetClosure);}
    catch(error){if(error.code==='CONTROL_WIDTH'&&mutable.has('width'))continue;throw error;}
    const flatten=node=>[node,...(node.children??[]).flatMap(flatten)];
    const bodies=new Set(spec.tabs?spec.tabs.pages.map(page=>spec.id+'.page.'+page.id):[spec.id+'.body']);
    const scrollRemaining=flatten(compiled.document.root).some(node=>bodies.has(node.id)&&node.type==='ScrollView'&&node.props.contentHeight>node.layout.height);
    const values=value=>({width:value.layout.width,maxHeight:value.layout.maxHeight,canvasWidth:value.canvas.width,canvasHeight:value.canvas.height});
    const before=values(original),after=values(spec);
    for(const key of dimensions)if(before[key]!==after[key])changes.push({dimension:key,before:before[key],after:after[key]});
    return {spec:validatePanelSpec(spec),evidence:{policy,mutableDimensions:[...mutable],changes,
      status:scrollRemaining?'FIXED_DIMENSIONS_REQUIRE_SCROLL':'CONTENT_VISIBLE',scrollRemaining:Boolean(scrollRemaining),realModelCalls:0}};
  }
  fail('DRAFT_WIDTH_FIT_UNAVAILABLE');
}
