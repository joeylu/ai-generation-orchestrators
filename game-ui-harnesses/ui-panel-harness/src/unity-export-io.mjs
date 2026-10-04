import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createOutputDirectory } from './io.mjs';
import { createUnityKitFiles, UNITY_SOURCE_PATHS } from './unity-kit.mjs';

const adapterRoot = new URL('../adapters/unity/', import.meta.url);

export async function readUnityAdapterSources() {
  return Object.fromEntries(await Promise.all(UNITY_SOURCE_PATHS.map(async path => [path,
    new TextDecoder('utf-8', { fatal: true }).decode(await readFile(new URL(path, adapterRoot)))])));
}

/** Build every byte before opening a fresh output directory. No Unity/model process. */
export async function exportUnityKit(bundle, core, output) {
  const { contents, manifest } = await createUnityKitFiles(bundle, core, await readUnityAdapterSources());
  const directory = await createOutputDirectory(output);
  // The manifest is last, after every fingerprinted file was written successfully.
  for (const [path, bytes] of contents) {
    const target = resolve(directory, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: 'wx' });
  }
  return { status: 'UNITY_IMPORT_KIT_BUILT', panelSha256: manifest.panelSha256, files: contents.size, unityImport: 'NOT_RUN' };
}
