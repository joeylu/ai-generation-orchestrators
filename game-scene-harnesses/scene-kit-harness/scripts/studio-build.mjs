import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join, dirname } from 'node:path';

export const packageRoot = fileURLToPath(new URL('../', import.meta.url));

// Explicit dependency roots are a development-only reuse option, never bundled metadata.
export function dependency(name, roots = []) {
  const expected = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  const version = expected.dependencies?.[name] ?? expected.devDependencies?.[name];
  for (const root of [packageRoot, ...roots]) {
    const require = createRequire(join(resolve(root), 'package.json'));
    try {
      const entry = require.resolve(name);
      let directory = dirname(entry), found;
      for (let i = 0; i < 5; i++, directory = dirname(directory)) {
        try { const p = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')); if (p.name === name) { found = p; break; } } catch {}
      }
      if (found?.version === version) return { require, entry };
    } catch {}
  }
  throw new Error(`Dependency ${name}@${version} is unavailable; use npm ci --ignore-scripts or explicit --dependencies roots`);
}

export async function buildStudio({ roots = [], output = join(packageRoot, 'dist/studio') } = {}) {
  const { build } = dependency('esbuild', roots).require('esbuild');
  const pixi = dependency('pixi.js', roots), viewport = dependency('pixi-viewport', roots);
  mkdirSync(output, { recursive: true });
  await build({
    entryPoints: [join(packageRoot, 'src/studio/app.mjs')], outfile: join(output, 'app.js'),
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true,
    alias: { 'pixi.js': pixi.entry, 'pixi-viewport': viewport.entry },
    logLevel: 'silent', legalComments: 'eof',
  });
  await build({entryPoints:[join(packageRoot,'src/studio/projects-page.mjs')],outfile:join(output,'projects.js'),bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,logLevel:'silent'});
  for (const file of ['index.html', 'style.css','projects.html','projects.css']) copyFileSync(join(packageRoot, 'src/studio', file), join(output, file));
  return output;
}
