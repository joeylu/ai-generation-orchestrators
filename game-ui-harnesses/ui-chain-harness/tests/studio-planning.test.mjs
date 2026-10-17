import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import Ajv from 'ajv';
import {referenceStyle} from '../src/studio/planning.mjs';
test('reference-led style is explicit, has no invented palette and preserves user description',async()=>{
 const validate=new Ajv({strict:true}).compile(JSON.parse(await readFile(new URL('../schemas/skin-style.schema.json',import.meta.url))));
 const description='暖色木纹'.repeat(800),style=referenceStyle({name:'示例',description,reference:{sha256:'a'.repeat(64)}},{sheets:[{parts:[{assetId:'panel.base'}]}]});
 assert.equal(validate(style),true,JSON.stringify(validate.errors));assert.deepEqual(style.palette.colors,{});assert.equal(style.extensionRules.slice(1).join(''),description);
 const old={...style,palette:{basis:'visual-estimate-not-colorimetric-sampling',colors:{}}};assert.equal(validate(old),false);
 assert.equal(validate({...old,palette:{...old.palette,colors:{paper:'#ffffff'}}}),true);
});
