/** Newly authored vectors; no edits to the immutable core icon library. */
const glyphs = {
  volume: '<path d="M3.5 10h4L12 6v16l-4.5-4h-4z"/><path d="M16 10.2a5.5 5.5 0 0 1 0 7.6M19.5 6.8a10.3 10.3 0 0 1 0 14.4"/>',
  music: '<path d="M10.5 20.5V8.5L22 6v12M10.5 12 22 9.5"/><ellipse cx="7.8" cy="21" rx="2.7" ry="2.1" transform="rotate(-16 7.8 21)" fill="currentColor" stroke="none"/><ellipse cx="19.3" cy="18.5" rx="2.7" ry="2.1" transform="rotate(-16 19.3 18.5)" fill="currentColor" stroke="none"/>',
  mute: '<path d="M3.5 10h4L12 6v16l-4.5-4h-4z"/><path d="m17 10 7 8m0-8-7 8"/>',
};
const labels = {volume:'主音量',music:'音乐',mute:'静音'};
export const AUDIO_ICON_ROWS = Object.freeze({'volume-row':'volume','music-row':'music','mute-row':'mute'});

export function audioLineIcon(name, mode) {
  if (!Object.hasOwn(glyphs,name) || !['light','dark'].includes(mode)) throw new Error('AUDIO_ICON_VARIANT');
  const color = mode === 'light' ? '#1D1D1F' : '#F5F5F7';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="112" height="112" viewBox="0 0 28 28" color="${color}" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${glyphs[name]}</svg>`;
}

export function audioLineIconBatch() {
  return {assetBatchVersion:'0.1',namespace:'audio-line',assets:['light','dark'].flatMap(mode=>Object.keys(glyphs).map(name=>({
    id:`${name}-${mode}`,version:'1.0.0',file:`${name}-${mode}.svg`,name:`${labels[name]}·${mode}`,role:'icon',
    family:`audio.${name}`,style:'audio-line-v1',variant:mode,tags:[labels[name],name,'audio','line'],size:{width:112,height:112},slice:null,
  })))};
}

/** Isolated icon study: exact saved layout/rows/state, only theme and asset references change. */
export function plainAudioIconStudy(source, library) {
  if (source.spec.id !== 'usage-settings' || source.spec.provenance.kind !== 'programmatic-fixture'
    || source.compilerVersion !== '0.21.0') throw new Error('PLAIN_AUDIO_GROUPED_FIXTURE_ONLY');
  const spec=structuredClone(source.spec),catalog=structuredClone(source.catalog);
  const theme=catalog.themes.find(item=>item.id===spec.theme.id&&item.version===spec.theme.version);
  if(theme?.surfaceStyle!=='grouped-v1'||spec.assets.panelSurface!==null
    || spec.assets.rowIcons.map(item=>item.rowId).join('|')!==Object.keys(AUDIO_ICON_ROWS).join('|')) throw new Error('PLAIN_AUDIO_SOURCE');
  const mode=theme.id.endsWith('-dark')?'dark':'light';
  theme.version='0.13.0';theme.iconStyle='plain-v1';catalog.id='plain-audio-icon-study';
  spec.theme={id:theme.id,version:theme.version};
  spec.assets={...spec.assets,library:structuredClone(library),rowIcons:spec.assets.rowIcons.map(item=>({...item,asset:`audio-line/${AUDIO_ICON_ROWS[item.rowId]}-${mode}@1.0.0`}))};
  return {spec,catalog};
}
