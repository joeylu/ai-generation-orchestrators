import type { UiNodeType } from './tree-contract.ts';

type PreviewPolicyValue = boolean | number | 'none' | 'clip';
type RequiredPreviewProps = Readonly<Record<string, PreviewPolicyValue>>;

/** A normalized v0.2 contract node examined by the preview policy. */
export type PreviewPolicyNode = Readonly<{
  componentType: UiNodeType;
  props: Readonly<Record<string, unknown>>;
}>;

/**
 * Deterministic configuration for the local preview. These values are not
 * visual observations and never provide text or content defaults.
 */
export type VisionPreviewPolicyV1 = Readonly<{
  version: 'v1';
  kind: 'preview-configuration';
  observedFactDefaults: false;
  textContentDefaults: false;
  requiredProps: Readonly<Partial<Record<UiNodeType, RequiredPreviewProps>>>;
}>;

const requiredProps = Object.freeze({
  Button: Object.freeze({ enabled: true }),
  Switch: Object.freeze({ enabled: true }),
  CheckBox: Object.freeze({ enabled: true }),
  RadioGroup: Object.freeze({ enabled: true }),
  Input: Object.freeze({ enabled: true, readOnly: false, maxLength: 1024 }),
  Select: Object.freeze({ enabled: true }),
  Slider: Object.freeze({ enabled: true }),
  List: Object.freeze({ enabled: true }),
  Dialog: Object.freeze({ modal: false }),
  Tabs: Object.freeze({ enabled: true }),
  Text: Object.freeze({ wrap: 'none' as const, overflow: 'clip' as const }),
});

/** The complete, immutable v1 policy for nonvisual local preview settings. */
export const VISION_PREVIEW_POLICY_V1: VisionPreviewPolicyV1 = Object.freeze({
  version: 'v1',
  kind: 'preview-configuration',
  observedFactDefaults: false,
  textContentDefaults: false,
  requiredProps,
});

function fail(): never { throw new Error('VISION_PREVIEW_POLICY_VIOLATION'); }

/**
 * Rejects a normalized v0.2 contract whose explicit props conflict with the
 * v1 preview configuration. This validator never supplies or changes props.
 */
export function validateVisionPreviewPolicyV1(nodes: Iterable<PreviewPolicyNode>): void {
  for (const node of nodes) {
    const required = VISION_PREVIEW_POLICY_V1.requiredProps[node.componentType];
    if (!required) continue;
    for (const [key, expected] of Object.entries(required)) {
      if (!Object.hasOwn(node.props, key) || node.props[key] !== expected) fail();
    }
  }
}
