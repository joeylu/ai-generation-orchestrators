import { classifyTexture } from './texture-semantics.mjs';

// Selection policy is separate from immutable source classification evidence.
export const TEXTURE_CURATION_POLICY = Object.freeze({ id: 'panel-core', version: '0.1' });

const BRAND_PLATFORM = /^(?:discord|facebook|github|instagram|reddit|steam|twitter|youtube)(?:$|[\s(])/;

/** Assign a generation-library role without changing historical path semantics. */
export function textureUsage(relativePath) {
  const { category } = classifyTexture(relativePath);
  const parts = relativePath.toLowerCase().split('/');
  if (parts[0] === 'textures') parts.shift();
  const path = parts.join('/');
  const basename = parts.at(-1).replace(/\.[^.]+$/, '');

  if (category === 'demo') return { role: 'excluded', reason: 'demo' };
  if (category === 'icon') {
    if (parts[1] === 'ui elements') return { role: 'excluded', reason: 'control-illustration' };
    if (parts[1] === 'communication & social' && BRAND_PLATFORM.test(basename)) {
      return { role: 'excluded', reason: 'brand-platform' };
    }
    if (parts.slice(1, -1).includes('animation icon stuff')) return { role: 'animation-part', reason: 'animation-part' };
    if (path === 'icon/others/panel seperator.png') return { role: 'layout-primitive', reason: 'panel-separator' };
    return { role: 'icon', reason: 'semantic-icon' };
  }
  if (category === 'border') {
    if (path === 'border/flat/square filled.png') return { role: 'layout-primitive', reason: 'flat-fill' };
    return { role: 'shape', reason: 'geometric-shape' };
  }
  if (category === 'shadow') return { role: 'effect', reason: 'shadow-effect' };
  return { role: 'excluded', reason: 'unsupported-role' };
}
