/** Only the slider treatment changes in the saved, local line-icon study. */
export function sliderClarityStudy(source) {
  if(source.compilerVersion!=='0.22.0'||source.spec.id!=='usage-settings'
    ||source.spec.provenance.kind!=='programmatic-fixture')throw new Error('SLIDER_CLARITY_FIXTURE_ONLY');
  const spec=structuredClone(source.spec),catalog=structuredClone(source.catalog);
  const theme=catalog.themes.find(item=>item.id===spec.theme.id&&item.version===spec.theme.version);
  if(theme?.surfaceStyle!=='grouped-v1'||theme.iconStyle!=='plain-v1')throw new Error('SLIDER_CLARITY_SOURCE');
  theme.version='0.14.0';theme.sliderStyle='raised-v1';catalog.id='slider-clarity-study';
  spec.theme={id:theme.id,version:theme.version};return {spec,catalog};
}
