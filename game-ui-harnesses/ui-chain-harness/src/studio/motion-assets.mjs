import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {motionChoices} from '../panel/motion-profile.mjs';
let bundled,comparison;
// One build per local Studio process. Import the upstream scheduler; never copy it.
export async function studioMotionAssets(files){
 bundled??=build({entryPoints:[fileURLToPath(new URL('./panel-motion-ui.mjs',import.meta.url))],bundle:true,format:'esm',platform:'browser',write:false,target:'es2022'}).then(r=>r.outputFiles[0].contents);
 files.set('panel-motion-ui.mjs',Buffer.from(await bundled));
 files.set('motion-presets.json',Buffer.from(JSON.stringify(motionChoices)));
 comparison??=build({entryPoints:[fileURLToPath(new URL('./motion-compare.mjs',import.meta.url))],bundle:true,format:'esm',platform:'browser',write:false,target:'es2022'}).then(r=>r.outputFiles[0].contents);
 files.set('motion-compare.mjs',Buffer.from(await comparison));
 files.set('motion-compare.html',await readFile(new URL('./motion-compare.html',import.meta.url)));
}
