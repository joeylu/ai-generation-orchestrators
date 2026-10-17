import { parseArgs } from 'node:util';
import { resolve, join, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reserveAttempt, receiveAttempt } from '../src/skin-generation/attempt.mjs';
const root = fileURLToPath(new URL('../work/', import.meta.url));
try {
  const { values: v, positionals: p } = parseArgs({ allowPositionals: true, options: {
    plan: { type: 'string' }, sha256: { type: 'string' }, confirmed: { type: 'string' }, out: { type: 'string' }, raw: { type: 'string' }, attempt: { type: 'string' },
  }});
  if (p.length!==1 || !v.plan || !v.sha256) throw Error('Expected reserve/receive, --plan and --sha256.');
  const insideWork = path => { const full=resolve(path), rel=relative(root,full); if (isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep)) throw Error('Attempt files must stay under Harness work/.'); return full; };
  const planDirectory=insideWork(v.plan), planSha256=v.sha256;
  let result;
  if(p[0]==='reserve') result=await reserveAttempt({ planDirectory, planSha256, confirmedPlanSha256:v.confirmed, output:insideWork(v.out??join(root,'skin-attempts')) });
  else if(p[0]==='receive'&&v.raw&&v.attempt) result=await receiveAttempt({ planDirectory, planSha256, directory:insideWork(v.attempt), raw:resolve(v.raw) });
  else throw Error('Invalid command/arguments.');
  console.log(JSON.stringify(result,null,2));
} catch(e) { console.error(JSON.stringify({ status:'failed', code:e.code??'skin.attempt', message:e.code?.startsWith('skin.')?e.message:'Attempt operation failed; no submission/retry is performed.' })); process.exitCode=1; }
