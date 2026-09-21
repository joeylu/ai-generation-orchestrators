import { build } from 'vite';
import { readFile,writeFile } from 'node:fs/promises';
await build({configFile:'vite.layers.config.ts'});
const html=(await readFile('layer-viewer.html','utf8')).replace('<script type="module" src="/src/layer-viewer.ts"></script>','<script src="./viewer.js"></script>');
await writeFile('dist-layers/viewer.html',html);
