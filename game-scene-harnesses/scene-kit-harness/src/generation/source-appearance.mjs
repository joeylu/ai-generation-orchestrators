import {canonicalJson} from '../document.mjs';
import {check,contract,text} from './common.mjs';

export const SOURCE_APPEARANCE_PROFILE='source-owned-appearance-v1';
export const SOURCE_ATMOSPHERE_PROMPT_PROFILE='reference-atmosphere-v1';

// The caller selects source-local appearance rules explicitly. This contract
// never guesses which words in a scene rule are layout or appearance.
export function validateSourceAppearance(value){
  contract(value);
  check(value.profile===SOURCE_APPEARANCE_PROFILE,'SOURCE_APPEARANCE_PROFILE');
  value.rules.forEach(rule=>text(rule,{limit:1000}));
  return structuredClone(value);
}

export function sourceAppearancePrompt(value,styleName){
  const appearance=validateSourceAppearance(value);text(styleName,{limit:1000});
  if(appearance.promptProfile===SOURCE_ATMOSPHERE_PROMPT_PROFILE)return [
    'SOURCE STYLE OWNERSHIP: only this source brief owns content, count, support and layout. The whole-scene style rule list is deliberately not inherited; the scene style name is only an appearance label.',
    `Source appearance: ${canonicalJson({name:styleName,profile:appearance.profile,promptProfile:appearance.promptProfile,rules:appearance.rules})}`,
    'REFERENCE APPEARANCE: match the visible painted appearance of this source in image 1, including its illumination and depth-dependent color, rather than reconstructing neutral unlit material colors. The selected rules own broad-face value, contrast, saturation, atmospheric color and any directional gradient. Preserve their relationships; do not relight every asset for a bright standalone product presentation. Local emissive accents and ambient atmospheric light are separate responsibilities.',
    'Atmospheric color and reduced internal contrast belong in the painted surfaces when selected here. For a transparent source, keep real holes and exterior space transparent and retain material coverage Alpha; do not make solid surfaces translucent to simulate distance. Do not invent a fog rectangle or surrounding glow. A separate editable fog layer or Studio appearance operation must be explicitly assigned outside this source; never assume it will restore omitted appearance later.',
    'These rules are selected observations, not automatic image measurements or art acceptance. They impose no universal dark foreground, blue distance or gradient direction. Review the actual source and whole composition independently.'
  ].join('\n\n');
  return [
    'SOURCE STYLE OWNERSHIP: the whole-scene style rule list is deliberately not inherited. Content, count, support and layout belong only to this source brief and its explicit role contracts. Match image 1 original material colors, brushwork, edge treatment, light direction and softness; preserve the requested depth through the source visual-coherence contract. The scene style name is an appearance label, never permission to add neighboring subjects.',
    `Source appearance: ${canonicalJson({name:styleName,profile:appearance.profile,rules:appearance.rules})}`,
    'The source appearance rules above are explicitly selected task data for this source. They are not an automatic extraction, classification or semantic guarantee. Keep actual source content and final art independently reviewed.'
  ].join('\n\n');
}
