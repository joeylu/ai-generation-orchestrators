/** Checkout uses reviewed sources; installed distributions use compiled modules. */
import { existsSync } from 'node:fs';
export function harnessModule(name) {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error('HARNESS_MODULE_INVALID');
  const source = new URL(`../src/${name}.ts`, import.meta.url);
  return import(existsSync(source) ? source.href : new URL(`../lib/${name}.js`, import.meta.url).href);
}
