import { createHash } from 'node:crypto';
import { appearanceApplicationFixture } from './appearance-application-fixture.ts';
import { forceZip64Stored } from './decomposition-fixture.ts';

export async function componentHandoffFixture(badDigest = false) {
  const value = await appearanceApplicationFixture();
  const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  const bundle = encode(value.target), binding = encode(value.binding);
  const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  return forceZip64Stored([
    { name: 'handoff.json', bytes: encode({ kind: 'ai_ui_component_handoff_v1', status: 'contracts_packaged_unreviewed_draft',
      decomposition: { path: 'decomposition/fixture.draft.zip', sha256: sha(value.fixture.zip) },
      component_bundle: { path: 'component.ui-bundle.json', sha256: badDigest ? '0'.repeat(64) : sha(bundle) },
      appearance_binding: { path: 'appearance-binding.json', sha256: sha(binding) },
      delivery_policy: 'unreviewed_draft', human_visual_acceptance: false }), },
    { name: 'component.ui-bundle.json', bytes: bundle },
    { name: 'appearance-binding.json', bytes: binding },
    { name: 'decomposition/fixture.draft.zip', bytes: value.fixture.zip },
  ]);
}
