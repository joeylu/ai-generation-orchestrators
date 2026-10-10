import { hasTextWrap,wrapStaticText } from './text-wrap.mjs';
import { buttonFontSize } from './button-font.mjs';
import { measureFocusedSection } from './focused-presentation.mjs';
import { measureMinimalSection } from './minimal-presentation.mjs';
import { measureCraftedSettings } from './crafted-presentation.mjs';
import { measureGroupedSection } from './grouped-presentation.mjs';
import { measureAlignedSettings } from './aligned-settings-presentation.mjs';
import {isStandaloneMenu,measurePolishedMenu} from './menu-presentation.mjs';
import { sectionHeadingVisible } from './section-headings.mjs';
import { resolveRecipe } from './catalog.mjs';

/** Opt-in modern-v3 geometry. Typed controls determine presentation; actions remain unchanged. */
export const presentationTextWidth = (value, size) => Math.ceil([...value].reduce((sum, char) => sum + (/^[\x00-\x7f]$/.test(char) ? size * 0.8 : size * 1.1), 0));

export function sectionPurpose(section) {
  const kinds = section.rows.map(row => row.kind);
  if (kinds.every(kind => kind === 'button')) return 'menu';
  if (kinds.includes('input') && kinds.every(kind => ['input', 'text', 'button'].includes(kind))) return 'form';
  if (kinds.includes('button') && kinds.every(kind => ['text', 'button'].includes(kind))) return 'dialog';
  return 'settings';
}

export function createPresentationPolicy(spec, tokens, presentationStyle, surfaceStyle, headingStyle, catalog) {
  const sectionMinimum = ['concise-v2','visible-v2'].includes(headingStyle)
    ? resolveRecipe(catalog, {id:'settings.section',version:'0.1.0'}, 'section').minHeight : 0;
  const polishedMenu = surfaceStyle === 'minimal-v2' && isStandaloneMenu(spec);
  if (surfaceStyle === 'minimal-v2') surfaceStyle = 'minimal-v1';
  const l = spec.layout, textHeight = Math.ceil(tokens.fontSize * 1.3);
  const groupedProfile = ['grouped-v1','grouped-v2','grouped-v3'].includes(surfaceStyle), crafted = groupedProfile || surfaceStyle === 'crafted-v1', minimal = crafted || surfaceStyle === 'minimal-v1';
  const icons = new Set((spec.assets?.rowIcons ?? []).map(icon => icon.rowId));
  const overrides = new Map((spec.buttonStyles ?? []).map(value => [value.rowId, value.style]));
  const reject = (code, message) => { const error = new Error(message); error.code = code; throw error; };
  const geometry = (row, width, height, shape = 'default') => {
    const local = overrides.get(row.id), w = local?.width ?? width, h = local?.height ?? height, circle = (local?.shape ?? shape) === 'circle';
    if (circle && w !== h) reject('BUTTON_STYLE_CIRCLE', 'Circle button width and height must match');
    if (presentationTextWidth(row.buttonLabel, buttonFontSize(spec, row.id, tokens.fontSize)) + 16 > w) reject('ACTION_LAYOUT_LABEL', 'Button labels do not fit the requested button width');
    return { width: w, height: h, circle };
  };
  const heading = value => value.trim().replace(/(?:界面|面板)$/, '');
  const measure = (section, width) => {
    const purpose = sectionPurpose(section), compact = ['form', 'dialog'].includes(purpose);
    const redundantHeading = !spec.tabs && heading(spec.title) === heading(section.title)
      && (crafted ? true : ['refined-v1','minimal-v1'].includes(surfaceStyle) ? section.id === spec.sections[0].id : compact && spec.sections.length === 1);
    const showTitle = sectionHeadingVisible(spec, section, headingStyle, !redundantHeading);
    const titleHeight = showTitle ? l.sectionTitleHeight + l.gap : 0;
    const explicit = spec.actionLayouts?.find(value => value.sectionId === section.id);
    if (explicit) {
      const { buttonWidth, buttonHeight, gap, direction, align, shape } = explicit;
      const sizes = section.rows.map(row => geometry(row, buttonWidth, buttonHeight, shape));
      const totalWidth = direction === 'row' ? sizes.reduce((sum, value) => sum + value.width, 0) + (sizes.length - 1) * gap : Math.max(...sizes.map(value => value.width));
      if (totalWidth > width) reject('ACTION_LAYOUT_OVERFLOW', 'Button arrangement exceeds its section width');
      if (section.rows.some(row => icons.has(row.id))) reject('ACTION_LAYOUT_ICONS', 'Standalone button arrangement currently requires inline glyph labels rather than external row icons');
      const x = align === 'center' ? (width - totalWidth) / 2 : align === 'end' ? width - totalWidth : 0;
      const height = Math.max(56, ...sizes.map(value => value.height));
      return { purpose, showTitle, grouped: direction === 'row', height: Math.max(80, titleHeight + (direction === 'row' ? height : sizes.reduce((sum, value) => sum + Math.max(56, value.height), 0) + (sizes.length - 1) * gap)),
        rows: sizes.map((size, index) => ({ y: titleHeight + (direction === 'column' ? sizes.slice(0,index).reduce((sum,value)=>sum+Math.max(56,value.height)+gap,0) : 0), height: direction === 'row' ? height : Math.max(56,size.height),
          stacked: false, buttonRole: null, explicitAction: true, circle: size.circle,
          controlX: direction === 'row' ? x + sizes.slice(0,index).reduce((sum,value)=>sum+value.width+gap,0) : align === 'center' ? (width-size.width)/2 : align === 'end' ? width-size.width : 0,
          controlWidth: size.width, controlHeight: size.height })) };
    }
    if (polishedMenu) return measurePolishedMenu(spec,tokens,section,width,showTitle,geometry);
    if(surfaceStyle==='grouped-v3')return measureAlignedSettings(spec,tokens,section,width,purpose,showTitle,geometry);
    if(groupedProfile){
      const measured=measureGroupedSection(spec,tokens,section,width,purpose,showTitle,geometry,surfaceStyle==='grouped-v2'?2:1);
      if(measured)return measured;
    }
    if (presentationStyle === 'focused-v1' && purpose !== 'settings') {
      if(minimal) {
        const minimal=measureMinimalSection(spec,tokens,section,width,purpose,geometry,showTitle);
        if(minimal)return crafted ? {...minimal,height:Math.max(80,minimal.height)} : minimal;
      }
      const focused = measureFocusedSection(spec, tokens, section, width, purpose,
        minimal?(row,w,h,shape)=>geometry(row,w,Math.max(48,h),shape):geometry,
        (minimal || surfaceStyle==='refined-v1') ? showTitle : undefined);
      if(focused&&minimal) {
        let extra=0;
        section.rows.forEach((row,i)=>{
          const place=focused.rows[i];
          place.y+=extra;
          if(row.kind==='input') {
            const errorWidth=Math.max(...[row.validation.requiredMessage,row.validation.minLengthMessage].map(message=>presentationTextWidth(message,14)));
            const inline=presentationTextWidth(row.label,tokens.fontSize)+(icons.has(row.id)?40:0)+errorWidth+16<=width;
            const height=Math.max(l.rowHeight,inline?textHeight+60:textHeight*2+76);
            extra+=height-place.height;
            Object.assign(place,{labelX:0,iconX:0,controlX:0,controlWidth:width,height,inputErrorInline:inline,errorWidth});
          }
        });
        focused.height+=extra;
      }
      if (focused) return focused;
    }
    if(crafted) {
      const measured=measureCraftedSettings(spec,tokens,section,width,purpose,showTitle);
      if(measured)return measured;
    }
    if(minimal) {
      const minimal=measureMinimalSection(spec,tokens,section,width,purpose,geometry,showTitle);
      if(minimal)return minimal;
    }
    const placements = [], primary = compact
      ? section.rows.find(row => row.kind === 'button' && row.action.kind === 'submit')
        ?? section.rows.find(row => row.kind === 'button' && row.action.kind === 'emit') : null;
    const buttonWidth = row => (overrides.get(row.id)?.width ?? Math.max(120, presentationTextWidth(row.buttonLabel, tokens.fontSize) + 32)) + (icons.has(row.id) ? 40 : 0);
    let footerStart = section.rows.length;
    if (compact) while (footerStart > 0 && section.rows[footerStart - 1].kind === 'button' && section.rows[footerStart - 1].label === '') footerStart--;
    const footer = section.rows.slice(footerStart), footerWidth = footer.reduce((sum, row) => sum + buttonWidth(row), 0) + Math.max(0, footer.length - 1) * l.gap;
    const grouped = footer.length > 1 && footerWidth <= width - 24;
    let y = titleHeight;
    for (const [index, row] of section.rows.entries()) {
      const textBlock = row.kind==='text' && hasTextWrap(spec,row.id) ? wrapStaticText(row.text,width-24,tokens.fontSize) : null;
      const stacked = Boolean(textBlock) || purpose === 'form' && row.kind === 'input';
      const height = textBlock ? Math.max(l.rowHeight,56,24+textHeight+8+textBlock.height) : grouped && index >= footerStart ? Math.max(l.rowHeight, 56, ...footer.map(button => overrides.get(button.id)?.height ?? 44))
        : row.kind === 'input' ? Math.max(l.rowHeight, stacked ? 2 * textHeight + 60 : Math.max(80, textHeight + 48))
        : row.kind === 'button' && overrides.has(row.id) ? Math.max(l.rowHeight, 56, overrides.get(row.id).height ?? 44)
        : Math.max(l.rowHeight, 56);
      const placement = { y, height, stacked, ...(textBlock ? {textBlock,allowPartialScroll:true} : {}), buttonRole: compact && row.kind === 'button' ? row === primary ? 'primary' : 'secondary' : null };
      if (grouped && index >= footerStart) {
        const cellX = width - 12 - footerWidth + footer.slice(0, index - footerStart).reduce((sum, item) => sum + buttonWidth(item) + l.gap, 0);
        placement.controlX = cellX + (icons.has(row.id) ? 40 : 0);
        placement.controlWidth = buttonWidth(row) - (icons.has(row.id) ? 40 : 0);
        placement.iconX = cellX;
      }
      const local = overrides.get(row.id);
      if (row.kind === 'button' && local && ['width','height','shape'].some(key => local[key] !== null)) {
        const naturalWidth = placement.controlWidth ?? width - 24 - (icons.has(row.id) ? 40 : 0);
        const size = geometry(row, naturalWidth, 44);
        if (size.width > naturalWidth) reject('ACTION_LAYOUT_OVERFLOW', 'Button size exceeds its available section width');
        placement.controlX ??= (width-size.width)/2;
        Object.assign(placement, {controlWidth:size.width,controlHeight:size.height,circle:size.circle,explicitAction:true});
      }
      placements.push(placement);
      if (!(grouped && index >= footerStart && index < section.rows.length - 1)) y += height + (index < section.rows.length - 1 ? l.gap : 0);
    }
    return { purpose, showTitle, grouped, height: Math.max(80, y), rows: placements };
  };
  // The shared flow/intent/compiler measurement owns the recipe floor. Preserve
  // row positions (including y=0); the minimum adds no title node or title band.
  return (section, width) => {
    const measured = measure(section, width);
    return sectionMinimum ? {...measured, height:Math.max(sectionMinimum, measured.height)} : measured;
  };
}
