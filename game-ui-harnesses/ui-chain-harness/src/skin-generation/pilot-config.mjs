import Ajv from 'ajv';
import theme from '../../schemas/runtime-theme.schema.json' with {type:'json'};
const ajv=new Ajv({allErrors:true,strict:true});
ajv.addSchema(theme,'runtime-theme');
const validate=ajv.compile({type:'object',additionalProperties:false,required:['kind','version','widths','profileOverrides','roles'],properties:{
  kind:{const:'ui_partial_skin_acceptance'},version:{const:'0.1'},
  widths:{type:'array',minItems:1,maxItems:3,uniqueItems:true,items:{type:'integer',minimum:128,maximum:480}},
  profileOverrides:{type:'object',additionalProperties:false,properties:{
    markSize:{$ref:'runtime-theme#/properties/markSize'},trackHeight:{$ref:'runtime-theme#/properties/trackHeight'},thumbSize:{$ref:'runtime-theme#/properties/thumbSize'},
    palette:{type:'object',additionalProperties:false,properties:{text:{$ref:'runtime-theme#/properties/palette/properties/text'}}},
    geometry:{type:'object',additionalProperties:false,properties:{scrollbarWidth:{$ref:'runtime-theme#/properties/geometry/properties/scrollbarWidth'},minThumbLength:{$ref:'runtime-theme#/properties/geometry/properties/minThumbLength'}}}
  }},
  roles:{type:'object',minProperties:1,maxProperties:32,propertyNames:{pattern:'^skin\\.[a-z0-9.-]+$'},additionalProperties:{type:'object',additionalProperties:false,required:['crossAxis','profileToken','slice'],properties:{
    crossAxis:{enum:['width','height']},profileToken:{enum:['trackHeight','thumbSize','markSize','geometry.scrollbarWidth']},profileOffset:{type:'number',minimum:-16,maximum:16},slice:{enum:['uniform','capsule-x','capsule-y']}
  }}}
}});
export function validatePilotConfig(value){
  if(!validate(value))throw Error('Invalid partial pilot configuration.');
  for(const r of Object.values(value.roles))if((r.slice==='capsule-x'&&r.crossAxis!=='height')||(r.slice==='capsule-y'&&r.crossAxis!=='width'))throw Error('Pilot capsule density axis is inconsistent.');
  return value;
}
