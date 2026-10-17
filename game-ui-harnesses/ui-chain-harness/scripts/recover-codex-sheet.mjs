import {resolve} from 'node:path';
import {homedir} from 'node:os';
import {recoverCodexSheet} from '../src/skin-generation/codex-recovery.mjs';
const args=process.argv.slice(2),options={};
const allowed=new Set(['--project','--batch','--sheet','--relay-root','--codex-home']);
for(let i=0;i<args.length;i+=2){if(!allowed.has(args[i])||!args[i+1]||options[args[i]])throw Error('Invalid recovery arguments');options[args[i]]=args[i+1];}
if(!options['--project']||!options['--batch']||!options['--sheet'])throw Error('Required: --project directory --batch sha256 --sheet S01');
const result=await recoverCodexSheet({skinDirectory:resolve(options['--project']),batchSha256:options['--batch'],sheetId:options['--sheet'],relayRoot:resolve(options['--relay-root']??'work/skin-codex-relay'),home:resolve(options['--codex-home']??process.env.CODEX_HOME??resolve(homedir(),'.codex'))});
process.stdout.write(JSON.stringify(result,null,2)+'\n');
