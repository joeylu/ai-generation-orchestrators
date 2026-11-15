import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, parse, relative, resolve, sep } from 'node:path';
import { demand, InvalidKit, reject } from './errors.mjs';

export const portablePath = name => typeof name === 'string' && !/[\s\x00-\x1f]/u.test(name)
  && /^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(name);
export const isWithin = (root, path) => {
  const local = relative(root, path);
  return !isAbsolute(local) && local !== '..' && !local.startsWith(`..${sep}`);
};

function checkAncestors(fullPath) {
  demand(!fullPath.startsWith('\\\\'), 'PATH_UNSAFE', 'output', '/', 'Only local filesystem targets are supported');
  const drive = parse(fullPath).root;
  let current = drive;
  for (const segment of relative(drive, fullPath).split(sep).filter(Boolean)) {
    current = resolve(current, segment);
    demand(!lstatSync(current).isSymbolicLink(), 'PATH_UNSAFE', 'output', '/', 'Linked path components are not permitted');
  }
}

export function freshTarget(path, sourceRoot) {
  try {
    const target = resolve(path);
    demand(!isWithin(sourceRoot, target), 'OUTPUT_OVERLAP', 'output', '/', 'Output must be outside the immutable source kit');
    checkAncestors(dirname(target));
    demand(lstatSync(dirname(target)).isDirectory(), 'OUTPUT_PARENT', 'output', '/', 'Output parent must be an existing directory');
    try {
      lstatSync(target);
      reject('OUTPUT_EXISTS', 'output', '/', 'Output must be a fresh file or directory');
    } catch (error) {
      if (error instanceof InvalidKit) throw error;
      if (error.code !== 'ENOENT') throw error;
    }
    return target;
  } catch (error) {
    if (error instanceof InvalidKit) throw error;
    reject('OUTPUT_UNAVAILABLE', 'output', '/', 'Cannot prepare the selected output');
  }
}

export function writeFreshFile(path, bytes, sourceRoot) {
  const target = freshTarget(path, sourceRoot);
  try { writeFileSync(target, bytes, { flag: 'wx' }); }
  catch { reject('OUTPUT_WRITE_FAILED', 'output', '/', 'Cannot write fresh output; partial output is retained if present'); }
}

export function makeFreshDirectory(path, sourceRoot) {
  const target = freshTarget(path, sourceRoot);
  try { mkdirSync(target); } catch { reject('OUTPUT_WRITE_FAILED', 'output', '/', 'Cannot create fresh output directory'); }
  return target;
}

export function readSelectedFile(path, limit = 2097152) {
  try {
    const target = resolve(path);
    checkAncestors(target);
    const stat = lstatSync(target);
    demand(stat.isFile() && stat.size <= limit, 'RESOURCE_LIMIT', 'scene.document.json', '/', 'Input must be a regular file within the size limit');
    return readFileSync(target);
  } catch (error) {
    if (error instanceof InvalidKit) throw error;
    reject('INPUT_UNAVAILABLE', 'scene.document.json', '/', 'Cannot read the selected input');
  }
}

export function parseJson(bytes, artifact = 'scene.document.json') {
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { reject('JSON_INVALID', artifact, '/', 'Malformed JSON input'); }
}

export function portableReader(inputRoot) {
  let root;
  try {
    demand(lstatSync(inputRoot).isDirectory() && !lstatSync(inputRoot).isSymbolicLink(), 'PATH_UNSAFE', 'manifest.json', '/', 'Export root must be a regular directory');
    root = realpathSync(inputRoot);
  } catch (error) {
    if (error instanceof InvalidKit) throw error;
    reject('INPUT_UNAVAILABLE', 'manifest.json', '/', 'Cannot read the selected export');
  }
  return { root, read(name, limit = 67108864) {
    demand(portablePath(name), 'PATH_UNSAFE', 'manifest.json', '/', 'Export references must be portable relative paths');
    const target = resolve(root, ...name.split('/'));
    demand(isWithin(root, target), 'PATH_UNSAFE', name, '/', 'Export reference escapes its root');
    return readSelectedFile(target, limit);
  } };
}
