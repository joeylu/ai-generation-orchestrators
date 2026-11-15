import { validateBundle } from '../src/index.mjs';

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  console.log('Usage: node scripts/validate.mjs --root PATH\nRead-only offline contract validation. No generation, export, or visual acceptance.');
} else if (args.length !== 2 || args[0] !== '--root' || !args[1]) {
  console.error(JSON.stringify({ ok: false, errors: [{ code: 'ARGUMENTS', message: 'Expected --root PATH; use --help' }] }));
  process.exitCode = 2;
} else {
  const result = validateBundle(args[1]);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}
