import { EDIT_STRESS_STEPS } from '../input-stress-v1/suite.mjs';

/** Ordered requests only. Later contexts must bind the preceding accepted result. */
const toggle = (enabled) => ({ expectation: enabled ? 'enableMute' : 'disableMute',
  text: `${enabled ? '重新启用' : '禁用'}静音开关，保留开关、静音状态、默认值、事件和恢复默认范围，其他不变。` });
const steps = [...EDIT_STRESS_STEPS.slice(0,4), toggle(false), toggle(true), ...EDIT_STRESS_STEPS.slice(4)];
export const EDIT_CHAIN_STEPS = steps.map((step,index) => ({ id:`edit${String(index+1).padStart(2,'0')}`,
  expectation:step.expectation, request:{requestVersion:'0.1',id:'panel-edit',target:'pixi',text:step.text} }));
export const EDIT_CHAIN_POLICY = Object.freeze({ model:'gpt-6-luna',effort:'xhigh',maxInvocations:10,
  attemptsPerStep:1,automaticRetries:0,timeoutMs:900000,
  failure:'Stop all subsequent steps on failed, indeterminate, clarification, no-change, semantic, compile or state gate. Never retry or reassign unused calls.',
  context:'Bind every fixed request to the preceding accepted real result, then persist context/schema digests before its only invocation.',
  trial:{main:83,mute:true,effectsAfterAddition:91},nativeEngines:'NOT_RUN',humanVisualReview:'NOT_RUN' });
