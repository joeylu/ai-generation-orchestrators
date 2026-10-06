/** Deterministic, provider-neutral comparison with explicit business expectations. */
import { canonicalJson } from './canonical.mjs';
import { validatePanelSpec } from './spec.mjs';

const kinds = { slider: 'slider-row', switch: 'switch-row', select: 'select-row', button: 'button-row', text: 'text-row', progress: 'progress-row' };
export function evaluateRecipeHits(context, expected) {
  const required = [...new Set(expected.rows.map(row => kinds[row.kind]))];
  const matches = required.map(kind => ({ kind, hit: context.candidates.some(recipe => recipe.kind === kind) }));
  return { status: matches.every(match => match.hit) ? 'PASS' : 'MISS', matches,
    candidateCount: context.candidates.length,
    assetCandidateCount: context.assetRetrieval?.candidates.length ?? 0,
    scope: 'Lexical row recipe retrieval; fixed panel/section recipes are available in the complete catalog; asset choice correctness is not scored' };
}

export function evaluatePanelSemantics(specInput, expected) {
  const spec = validatePanelSpec(specInput), rows = spec.sections.flatMap(section => section.rows);
  const checks = [], check = (name, actual, wanted) => checks.push({ name,
    status: canonicalJson(actual) === canonicalJson(wanted) ? 'PASS' : 'FAIL', expected: wanted, actual });
  check('title', spec.title, expected.title);
  check('row-count', rows.length, expected.rows.length);
  const label = row => row.kind === 'button' ? row.buttonLabel : row.label;
  check('row-order-and-labels', rows.map(label), expected.rows.map(row => row.label));
  check('state-count', spec.state.length, expected.rows.filter(row => ['slider', 'switch', 'select', 'progress'].includes(row.kind)).length + (expected.tabs ? 1 : 0));
  if (expected.tabs) {
    const tabs = spec.tabs, field = spec.state.find(field => field.id === tabs?.bind);
    check('tabs:enabled', tabs?.enabled ?? null, expected.tabs.enabled);
    check('tabs:page-labels', tabs?.pages.map(page => page.label) ?? null, expected.tabs.pages.map(page => page.label));
    check('tabs:state-type', field?.type ?? null, 'enum');
    check('tabs:initial-label', tabs?.pages.find(page => page.id === field?.initial)?.label ?? null, expected.tabs.initialLabel);
    check('tabs:page-membership', tabs?.pages.map(page => page.sections.flatMap(id => spec.sections.find(section => section.id === id)?.rows.map(label) ?? [])) ?? null,
      expected.tabs.pages.map(page => page.rowLabels));
  }
  for (const wanted of expected.rows) {
    const matches = rows.filter(row => label(row) === wanted.label);
    check(`row:${wanted.label}:unique`, matches.length, 1);
    if (matches.length !== 1) continue;
    const row = matches[0], field = spec.state.find(field => field.id === row.bind);
    check(`row:${wanted.label}:kind`, row.kind, wanted.kind);
    if (wanted.kind === 'text') { check(`row:${wanted.label}:text`, row.text ?? null, wanted.text); continue; }
    if (wanted.kind === 'progress') {
      check(`row:${wanted.label}:read-only`, !Object.hasOwn(row,'event') && !Object.hasOwn(row,'enabled'), true);
      check(`row:${wanted.label}:state-type`, field?.type ?? null, 'progress');
      for (const key of ['initial','max']) check(`row:${wanted.label}:${key}`, field?.[key] ?? null, wanted[key]);
      check(`row:${wanted.label}:format`, row.format, wanted.format); continue;
    }
    check(`row:${wanted.label}:enabled`, row.enabled ?? null, wanted.enabled);
    if (wanted.kind === 'button') {
      check(`row:${wanted.label}:action`, row.action?.kind ?? null, wanted.action);
      if (wanted.action === 'reset-initial') {
        const bindings = wanted.resetLabels.map(l => rows.find(r => label(r) === l)?.bind ?? null);
        check(`row:${wanted.label}:reset-scope`, [...(row.action?.fields ?? [])].sort(), [...bindings].sort());
      }
    } else if (wanted.kind === 'select') {
      check(`row:${wanted.label}:options`, field?.options?.map(option => option.label) ?? null, wanted.options);
      check(`row:${wanted.label}:initial`, field?.options?.find(option => option.id === field.initial)?.label ?? null, wanted.initialLabel);
    } else {
      check(`row:${wanted.label}:initial`, field?.initial ?? null, wanted.initial);
      if (wanted.kind === 'slider') for (const key of ['min', 'max', 'step']) check(`row:${wanted.label}:${key}`, field?.[key] ?? null, wanted[key]);
    }
  }
  if (expected.layout) {
    const wanted = expected.layout;
    const body = spec.layout.body, child = body?.children?.[0];
    // A fill-width column containing only a fill-width grid of the requested
    // sections has identical geometry at every width. This is opt-in for an
    // expectation that describes group arrangement, never a general alias or
    // a change to the authored tree. Saved expectations remain exact-root checks.
    const singleGridWrapper = wanted.allowSingleColumnWrapper === true && wanted.kind === 'grid' && !expected.bodyShape
      && body?.kind === 'column' && body.width === 'fill' && body.children.length === 1
      && child.kind === 'grid' && child.width === 'fill' && child.children.length >= 2
      && child.children.length === spec.sections.length
      && child.children.every(node => node.kind === 'section' && node.width === 'fill');
    check('layout:kind', singleGridWrapper ? child.kind : body?.kind ?? null, wanted.kind);
    for (const key of ['width', 'maxHeight', 'overflow']) if (Object.hasOwn(wanted, key)) check(`layout:${key}`, spec.layout[key] ?? null, wanted[key]);
    if (Object.hasOwn(wanted, 'canvasWidth')) check('layout:canvas-width', spec.canvas.width, wanted.canvasWidth);
  }
  if (expected.groups) check('section:row-membership', spec.sections.map(section => section.rows.map(label)), expected.groups);
  if (expected.bodyShape) {
    const shape = node => node.kind === 'section' ? { kind: 'section', index: spec.sections.findIndex(section => section.id === node.sectionId) }
      : { kind: node.kind, children: node.children.map(shape) };
    check('layout:nested-body-shape', shape(spec.layout.body), expected.bodyShape);
  }
  return { panelSemanticEvaluationVersion: '0.1', status: checks.every(check => check.status === 'PASS') ? 'PASS' : 'FAIL', checks,
    scope: 'Exact requested rows/order/text/defaults/ranges/options/enabled/actions/layout; no human visual or native engine acceptance' };
}
