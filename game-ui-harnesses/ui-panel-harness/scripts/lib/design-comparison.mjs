/** Isolated evaluation-only prompt selection. Production runtime defaults are unchanged. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {Writable} from 'node:stream';
import {digestBytes} from '../../src/canonical.mjs';
export const EXCERPT_RULES={
  'ui-ux-pro-max':[
    {file:'ui-ux-pro-max--references__quick-reference.md',contains:['`primary-action`','`visual-hierarchy`','`spacing-scale`','`orientation-support`','`touch-density`','`line-length-control`','`scroll-behavior`','`style-match`','`consistency`','`font-scale`']},
  ],
  'game-ui-design':[
    {file:'game-ui-design--skills__game-ui-design__SKILL.md',contains:['2. Map the player','3. Match UI density','5. Design complete states','6. Implement controller','7. Verify in motion','- Menus:','Keep the UI grounded']},
    {file:'game-ui-design--skills__game-ui-design__references__game-ui-checklist.md',contains:['- The UI emphasizes','- Secondary information','- Text fits','- Menus feel']},
  ],
  'game-ui-ux':[
    {file:'game-ui-ux--skills__disciplines__game-ui-ux__SKILL.md',contains:['1. **Pick a layout model','2. **Choose a scaling strategy','3. **Respect the safe area','4. **Make every screen','7. **Verify across screens']},
    {file:'game-ui-ux--skills__disciplines__game-ui-ux__references__layout-and-flow.md',contains:['4. **Wrap or stop**','5. **Device coexistence:**','- Let containers **size to content**','- Keep icons separate']},
  ],
};
function excerpts(text,fragments){
  const lines=text.replaceAll('\r\n','\n').split('\n'),blocks=[];
  for(const fragment of fragments){const matches=lines.flatMap((line,index)=>line.includes(fragment)?[index]:[]);assert.equal(matches.length,1,'DESIGN_SOURCE_SELECTOR');
    const start=matches[0];let end=start+1;while(end<lines.length&&/^\s+\S/.test(lines[end]))end++;
    blocks.push({startLine:start+1,endLine:end,text:lines.slice(start,end).join('\n')});}
  return blocks;
}
export async function loadDesignRules(directory){
  const bytes=await readFile(join(directory,'sources.json')),manifest=JSON.parse(bytes),sources={};
  assert.equal(manifest.status,'SNAPSHOTTED_NOT_INSTALLED');
  for(const file of manifest.files){assert(/^[A-Za-z0-9_.-]+$/.test(file.name),'DESIGN_SOURCE_PATH');const content=await readFile(join(directory,file.name));
    assert.equal(content.length,file.bytes);assert.equal(await digestBytes(content),file.sha256,'DESIGN_SOURCE_HASH');sources[file.name]=new TextDecoder('utf-8',{fatal:true}).decode(content);}
  const arms={baseline:{text:'',selections:[]}};
  for(const [arm,rules]of Object.entries(EXCERPT_RULES)){
    const selections=rules.flatMap(rule=>{assert(sources[rule.file],'DESIGN_SOURCE_MISSING');return excerpts(sources[rule.file],rule.contains).map(block=>({file:rule.file,...block}));});
    const text=selections.map(block=>block.text).join('\n\n');assert(text.length>100&&text.length<10000,'DESIGN_RULE_SIZE');
    arms[arm]={text,selections};
  }
  return {manifest,manifestSha256:await digestBytes(bytes),sources,arms};
}
export function applyDesignRules(base,text){
  const marker='### Native CLI output schema';assert.equal(base.split(marker).length,2,'DESIGN_PROMPT_MARKER');
  const guidance='### Experimental design guidance\nThe following are selected design considerations only. Apply them only through fields supported by this invocation schema, within the pinned theme/compiler and explicit user requirements. Preserve every required control, copy, default, order and behavior. Do not add capabilities, tools, assets, game logic or extra output fields. When the schema cannot express a consideration, keep the supported layout; do not invent fields or drop content.\n\n'+text+'\n\n';
  return base.replace(marker,guidance+marker);
}
export function frozenPromptTransport(basePrompt,prompt,runProcess=spawn,onPrompt=()=>{}){
  assert(typeof basePrompt==='string'&&typeof prompt==='string');
  return (command,args,options)=>{
    const child=runProcess(command,args,options),original=child.stdin,chunks=[];
    const input=new Writable({write(chunk,encoding,callback){chunks.push(Buffer.from(chunk));callback();},final(callback){
      if(Buffer.concat(chunks).toString('utf8')!==basePrompt){callback(new Error('DESIGN_PROMPT_CHANGED'));return;}
      Promise.resolve().then(()=>onPrompt(prompt)).then(()=>original.end(prompt,callback),callback);
    }});
    original.on('error',error=>input.destroy(error));child.stdin=input;return child;
  };
}
