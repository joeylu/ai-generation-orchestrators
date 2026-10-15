import test from 'node:test';
import assert from 'node:assert/strict';
import config from '../configs/skin-pilot.json' with {type:'json'};
import { validatePilotConfig } from '../src/skin-generation/pilot-config.mjs';
test('pilot configuration validates closed overrides, positive sizes and density axes',()=>{
  assert.equal(validatePilotConfig(config),config);
  const wrong=structuredClone(config);wrong.roles['skin.bar.track'].crossAxis='width';assert.throws(()=>validatePilotConfig(wrong),/inconsistent/);
  for(const patch of [{extra:true},{widths:[180,180]},{profileOverrides:{thumbSize:-1}},{profileOverrides:{fontFamily:'unbundled'}}])assert.throws(()=>validatePilotConfig({...config,...patch}),/Invalid/);
});
