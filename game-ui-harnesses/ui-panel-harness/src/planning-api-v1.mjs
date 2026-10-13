// Public, offline planning boundary. Consumers must not import internal modules.
// This facade delegates to the existing implementation; it does not run models
// or materialize the legacy PanelSpec/layout.
import { createPlanningContext, validatePlanningContext } from './planning-context.mjs';
import { buildNativePanelIntentResponseSchema } from './panel-intent.mjs';
import { canonicalJson, digestJson } from './canonical.mjs';
import { snapshotJson } from './spec.mjs';

export const PLANNING_API_VERSION = '1.0';
const reject = message => { throw Object.assign(new Error(message), { code: 'PLANNING_API_INCOMPATIBLE' }); };
const keys = ['kind','apiVersion','context','responseSchema','schemaSha256','sha256'];
async function envelope(context) {
  const responseSchema = buildNativePanelIntentResponseSchema(context);
  const body = { kind:'ui_panel_planning_session',apiVersion:PLANNING_API_VERSION,context,responseSchema,schemaSha256:await digestJson(responseSchema) };
  return { ...body, sha256:await digestJson(body) };
}
export async function preparePlanning({ request, catalog, assetRetrieval, options = {} }) {
  return envelope(await createPlanningContext(request, catalog, assetRetrieval, options));
}
export async function verifyPlanning(input) {
  const session = snapshotJson(input);
  if (!session || Object.keys(session).sort().join('|') !== [...keys].sort().join('|') || session.apiVersion !== PLANNING_API_VERSION || session.kind !== 'ui_panel_planning_session') reject('Unsupported planning session/API version.');
  const context = await validatePlanningContext(session.context);
  const expected = await envelope(context);
  if (canonicalJson(expected) !== canonicalJson(session)) reject('Planning context, output schema or implementation contract changed; keep this snapshot and explicitly prepare a new session.');
  return expected;
}
