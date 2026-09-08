import test from 'node:test';
import assert from 'node:assert/strict';
import { HarnessError } from '../src/contract.ts';
import { compileWorkflow, type WorkflowRequest } from '../src/workflow.ts';
import type { MotionDocument } from '../src/motion.ts';

const style = {
  backgroundColor: '#FFFFFF', borderColor: '#113355', borderWidth: 1, cornerRadius: 4,
  textColor: '#001122', fontFamily: 'sans-serif', fontSize: 16, fontWeight: 'normal' as const, opacity: 1,
};

function request(): WorkflowRequest {
  return {
    workflowVersion: '0.1', id: 'workflow.primary',
    input: {
      kind: 'intent',
      intent: {
        intentVersion: '0.2', id: 'workflow-document', root: {
          id: 'root', componentType: 'Container', props: { style }, children: [
            { id: 'save', componentType: 'Button', props: { label: 'Save', enabled: true, style }, children: [] },
            { id: 'cancel', componentType: 'Button', props: { label: 'Cancel', enabled: true, style }, children: [] },
          ],
        },
      },
      facts: {},
      policy: {
        canvas: { width: 320, height: 180 },
        layout: {
          root: { x: 0, y: 0, width: 320, height: 180 },
          save: { x: 20, y: 30, width: 120, height: 44 },
          cancel: { x: 180, y: 30, width: 120, height: 44 },
        },
        layoutSource: { kind: 'explicit', description: 'Reviewed fixture layout.' },
      },
    },
    motion: { id: 'workflow-motion', style: 'premium', targets: 'all' },
  };
}

function expectIssue(run: () => unknown, code: string, path?: string): void {
  assert.throws(run, (error: unknown) => error instanceof HarnessError
    && error.issues.some(issue => issue.code === code && (path === undefined || issue.path === path)));
}

function timeline(targetId = 'save'): MotionDocument {
  return {
    motionVersion: '0.1', id: 'save-enter', scope: 'component', duration: 100,
    trigger: { type: 'manual' },
    tracks: [{ targetId, property: 'alpha', start: 0, duration: 100, from: 0, to: 1, easing: 'linear' }],
  };
}

test('intent source compiles a complete v0.2 document and binds every node for all targets', () => {
  const source = request();
  const result = compileWorkflow(source);
  assert.equal(result.id, 'workflow.primary');
  assert.equal(result.document.schemaVersion, '0.2');
  assert.deepEqual(result.motionSystem?.bindings.map(binding => [binding.targetId, binding.componentType]), [
    ['root', 'Container'], ['save', 'Button'], ['cancel', 'Button'],
  ]);
  assert.ok(result.motionSystem?.bindings.every(binding => binding.actions.length > 0));
});

test('document input supports an explicit target subset', () => {
  const document = compileWorkflow(request()).document;
  const result = compileWorkflow({
    workflowVersion: '0.1', id: 'workflow-subset', input: { kind: 'document', document },
    motion: { id: 'subset-motion', style: 'corporate', targets: ['cancel'] },
  });
  assert.deepEqual(result.motionSystem?.bindings.map(binding => binding.targetId), ['cancel']);
  assert.equal(result.motionSystem?.bindings[0].componentType, 'Button');
});

test('an authored timeline is independently validated and can coexist with a motion system', () => {
  const source = request();
  source.timeline = timeline();
  const result = compileWorkflow(source);
  assert.equal(result.motionSystem?.id, 'workflow-motion');
  assert.deepEqual(result.motion, timeline());

  const timelineOnly = request();
  timelineOnly.id = 'workflow-timeline-only';
  timelineOnly.motion = null;
  timelineOnly.timeline = timeline('cancel');
  assert.equal(compileWorkflow(timelineOnly).motion?.tracks[0].targetId, 'cancel');
});

test('strict requests reject legacy sources, unknown fields, malformed input, missing styles, and stale targets', () => {
  const unknown = request() as any;
  unknown.extra = true;
  expectIssue(() => compileWorkflow(unknown), 'UNSUPPORTED_FIELD', '$workflow.extra');

  expectIssue(() => compileWorkflow({ schemaVersion: '0.1', id: 'old', type: 'Button' }), 'LEGACY_INPUT', '$workflow.input');

  const invalidInput = request() as any;
  invalidInput.input = { kind: 'intent', intent: invalidInput.input.intent, policy: invalidInput.input.policy, facts: {}, document: {} };
  expectIssue(() => compileWorkflow(invalidInput), 'UNSUPPORTED_FIELD', '$workflow.input.document');

  const missingStyle = request() as any;
  delete missingStyle.motion.style;
  expectIssue(() => compileWorkflow(missingStyle), 'REQUIRED', '$workflow.motion.style');

  const staleTarget = request() as any;
  staleTarget.motion.targets = ['not-present'];
  expectIssue(() => compileWorkflow(staleTarget), 'UNKNOWN_TARGET', '$workflow.motion.targets[0]');

  const staleTimeline = request();
  staleTimeline.motion = null;
  staleTimeline.timeline = timeline('not-present');
  expectIssue(() => compileWorkflow(staleTimeline), 'UNKNOWN_TARGET', '$workflow.timeline.tracks[0].targetId');

  const noMotion = request();
  noMotion.motion = null;
  expectIssue(() => compileWorkflow(noMotion), 'MOTION_INTEGRATION_REQUIRED', '$workflow');
});

test('workflow compilation and returned values are isolated from caller-owned input', () => {
  const source = request();
  source.timeline = timeline();
  const before = structuredClone(source);
  const first = compileWorkflow(source);
  const second = compileWorkflow(source);
  assert.deepEqual(source, before);
  first.document.root.layout.width = 1;
  first.motionSystem!.bindings[0].actions.length = 0;
  first.motion!.tracks[0].to = 0.5;
  assert.equal(source.input.kind, 'intent');
  assert.equal(source.input.policy.layout.root.width, 320);
  assert.equal(source.timeline!.tracks[0].to, 1);
  assert.equal(second.document.root.layout.width, 320);
  assert.ok(second.motionSystem!.bindings[0].actions.length > 0);
  assert.equal(second.motion!.tracks[0].to, 1);
});
