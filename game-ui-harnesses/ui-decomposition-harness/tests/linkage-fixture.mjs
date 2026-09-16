// Local procedural data only; no media generation or private service.
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const [root,out]=process.argv.slice(2).map(p=>resolve(p));
await mkdir(out,{recursive:false});
const {compositeListHandoffFixture}=await import(pathToFileURL(resolve(root,'tests/helpers/list-item-contents-fixture.ts')));
const fixture=await compositeListHandoffFixture();
const source=resolve(out,'fixture.zip');await writeFile(source,fixture.zip,{flag:'wx'});
const cli=spawnSync(process.execPath,[resolve(root,'scripts/cli.mjs'),'component-handoff',source,'--output',resolve(out,'consumed.json')],{encoding:'utf8',windowsHide:true});
if(cli.status!==0)throw Error(cli.stderr||cli.stdout);
const hash=b=>createHash('sha256').update(b).digest('hex');
await writeFile(resolve(out,'state-matrix.json'),JSON.stringify({bundleSha256:hash(await readFile(resolve(out,'consumed.json'))),handoffSha256:hash(fixture.zip),fixture:true,human_visual_acceptance:false}),{flag:'wx'});
