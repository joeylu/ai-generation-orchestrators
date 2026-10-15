import {isMessageText} from './message-text.mjs';
import {hasTextWrap,wrapStaticText} from './text-wrap.mjs';
import {buttonFontSize} from './button-font.mjs';

/** Exact recipe opt-in; labels, action names and title words never choose a layout. */
export function isCompactMessageText(row,catalog){
  return isMessageText(row,catalog)&&catalog.recipes.some(recipe=>recipe.id===row.recipe.id&&recipe.version===row.recipe.version&&recipe.messageLayout==='compact-centered-v1');
}

/** One plain message followed by actions. Mixed data, tabs and icons retain existing geometry. */
export function compactMessageSection(spec,section,catalog){
  if(spec.tabs||spec.sections.length!==1||spec.assets?.rowIcons.some(icon=>section.rows.some(row=>row.id===icon.rowId)))return false;
  const firstButton=section.rows.findIndex(row=>row.kind==='button');
  return firstButton>0&&section.rows.slice(0,firstButton).every(row=>isCompactMessageText(row,catalog))
    &&section.rows.slice(firstButton).every(row=>row.kind==='button'&&row.label==='');
}

/** Intrinsic prose height and one centered action group; no changes to order or events. */
export function measureCompactMessage(spec,tokens,section,width,geometry,showTitle,catalog){
  const l=spec.layout,line=Math.ceil(tokens.fontSize*1.3),firstButton=section.rows.findIndex(row=>row.kind==='button');
  const messages=section.rows.slice(0,firstButton),footer=section.rows.slice(firstButton),rows=[];
  const widthOf=row=>Math.max(112,Math.ceil([...row.buttonLabel].reduce((sum,char)=>sum+(/^[\x00-\x7f]$/.test(char)?0.8:1.1),0)*buttonFontSize(spec,row.id,tokens.fontSize))+32);
  const sizes=footer.map(row=>geometry(row,Math.min(width,widthOf(row)),Math.max(44,Math.ceil(buttonFontSize(spec,row.id,tokens.fontSize)*1.3)+8)));
  const totalWidth=sizes.reduce((sum,size)=>sum+size.width,0)+Math.max(0,footer.length-1)*l.gap;
  const grouped=footer.length>1&&totalWidth<=width;
  const footerHeight=Math.max(l.rowHeight,56,...sizes.map(size=>size.height));
  let y=showTitle?l.sectionTitleHeight+l.gap:0;
  for(const [index,row]of messages.entries()){
    const recipe=catalog.recipes.find(recipe=>recipe.id===row.recipe.id&&recipe.version===row.recipe.version);
    const textBlock=hasTextWrap(spec,row.id)?wrapStaticText(row.text,width,tokens.fontSize):null;
    const height=Math.max(recipe.minHeight,textBlock?.height??line);
    rows.push({y,height,stacked:true,copy:true,copyTextY:0,textBlock,allowPartialScroll:Boolean(textBlock),labelVisible:false,labelX:0,labelY:0,controlX:0,controlWidth:width,buttonRole:null});
    y+=height+(index<messages.length-1?l.gap:0);
  }
  y+=Math.max(16,l.gap+8);
  let x=grouped?(width-totalWidth)/2:0;
  for(const [index,size]of sizes.entries()){
    const controlX=grouped?x:(width-size.width)/2;
    if(controlX<0){const error=new Error('Button exceeds compact message width');error.code='ACTION_LAYOUT_OVERFLOW';throw error;}
    rows.push({y,height:footerHeight,stacked:false,buttonRole:null,controlX,controlWidth:size.width,controlHeight:size.height,circle:size.circle,explicitAction:true});
    if(grouped)x+=size.width+l.gap;
    if(!grouped||index===sizes.length-1)y+=footerHeight+(index<sizes.length-1?l.gap:0);
  }
  return {purpose:'dialog',showTitle,grouped,height:Math.max(80,y),rows,compactMessage:true};
}

/** Center only short, unindented prose. Longer paragraphs remain readable at the left edge. */
export function centeredMessageTextIds(bundle){
  if(!['0.36.0','0.37.0','0.38.0','0.39.0','0.40.0','0.41.0','0.42.0','0.43.0','0.44.0','0.45.0'].includes(bundle.compilerVersion))return [];
  const flatten=node=>[node,...(node.children??[]).flatMap(flatten)],nodes=flatten(bundle.componentBundle.document.root),ids=[];
  for(const section of bundle.spec.sections){
    if(!compactMessageSection(bundle.spec,section,bundle.catalog))continue;
    for(const row of section.rows.filter(row=>row.kind==='text')){
      if(row.text!==row.text.trim()||/[\r\n\u2028\u2029]/u.test(row.text))continue;
      const base=`${bundle.spec.id}.row.${row.id}.control`,lines=nodes.filter(node=>node.type==='Text'&&(node.id===base||node.id.startsWith(base+'.line')));
      if(lines.length<=2)ids.push(...lines.map(node=>node.id));
    }
  }
  return ids;
}

/** Measure actual native glyphs; reset offsets before alignment to avoid drift on repeat calls. */
export function alignCompactMessageText(bundle,runtime){
  const ids=centeredMessageTextIds(bundle);for(const id of ids)runtime.applyMotion(id,{x:0});
  const nodes=new Map(runtime.inspect().nodes.map(node=>[node.id,node]));
  for(const id of ids){const node=nodes.get(id),glyph=node?.renderedTextBounds?.[0]?.bounds;if(glyph)runtime.applyMotion(id,{x:(node.bounds.width-glyph.width)/2-(glyph.x-node.bounds.x)});}
}
