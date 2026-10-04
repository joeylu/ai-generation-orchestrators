import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep, basename, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './canonical.mjs';

export const harnessRoot = fileURLToPath(new URL('../', import.meta.url));
export const jsonFileBytes = value => new TextEncoder().encode(`${canonicalJson(value)}\n`);

export async function readText(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.size > 128 * 1024) throw new Error('TEXT_FILE_LIMIT');
  return new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path));
}

export async function readJson(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.size > 2 * 1024 * 1024) throw new Error('JSON_FILE_LIMIT');
  return JSON.parse(await readFile(path, 'utf8'));
}

/** Workspace-development CLI deliberately confines every write to this Harness. */
export async function createOutputDirectory(input) {
  const target = resolve(input), root = resolve(harnessRoot), rel = relative(root, target);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('OUTPUT_OUTSIDE_HARNESS');
  if (rel.split(sep).some(part => /^(?:\.git|\.codex|\.agents)$/i.test(part))) throw new Error('OUTPUT_RESERVED_DIRECTORY');
  // Verify all existing ancestors, including the checkout root, before creating anything.
  for (let path = target; ; path = dirname(path)) {
    try { if ((await lstat(path)).isSymbolicLink()) throw new Error('OUTPUT_LINK_FORBIDDEN'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (dirname(path) === path) break;
  }
  try { await lstat(target); throw new Error('OUTPUT_EXISTS'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(dirname(target), { recursive: true });
  await mkdir(target); // No overwrite if another process wins the race.
  return target;
}

export async function writeNewJson(directory, name, value) {
  if (basename(name) !== name || !/^[A-Za-z0-9._-]+\.json$/.test(name)) throw new Error('OUTPUT_FILENAME');
  await writeFile(resolve(directory, name), jsonFileBytes(value), { flag: 'wx' });
}
