/** Optional local Node host helpers. No provider calls or authorization defaults. */
import {mkdirSync,openSync,writeFileSync,fsyncSync,closeSync,realpathSync,lstatSync,readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {builtinResultPath} from './generation-loop.mjs';

export function createLoopJournal(directory) {
  mkdirSync(directory); // Exclusive: an existing journal must never be resumed implicitly.
  let sequence=0;
  return async event=>{
    const data=JSON.stringify(event);
    const fd=openSync(join(directory,`${String(++sequence).padStart(4,'0')}.json`),'wx');
    try { writeFileSync(fd,data); fsyncSync(fd); }
    finally { closeSync(fd); }
  };
}

export function verifyBuiltinResult(response,directory,rootMode='direct') {
  const canonicalDirectory=path=>{
    try {return realpathSync.native(path);}
    catch(error) {if(error.code==='ENOENT')return path;throw error;}
  };
  const source=builtinResultPath(response,directory,rootMode,canonicalDirectory);
  const root=realpathSync.native(directory), actual=realpathSync.native(source);
  const expectedParent=rootMode==='direct'?dirname(actual):dirname(dirname(actual));
  if(lstatSync(source).isSymbolicLink() || lstatSync(dirname(source)).isSymbolicLink() || expectedParent!==root || !lstatSync(actual).isFile())
    throw new Error('LOOP_PHYSICAL_PATH_INVALID');
  const encoded=response.image_url.slice('data:image/png;base64,'.length);
  const inline=Buffer.from(encoded,'base64');
  if(inline.toString('base64')!==encoded ||
      !inline.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
    throw new Error('LOOP_INLINE_PNG_INVALID');
  if(!readFileSync(actual).equals(inline)) throw new Error('LOOP_SOURCE_BYTES_MISMATCH');
  return actual;
}
