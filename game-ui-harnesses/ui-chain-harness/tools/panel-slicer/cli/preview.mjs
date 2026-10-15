// The harness owns the loopback server and build publication; this tool selects
// its independent scope without copying that infrastructure.
if (process.argv.some(arg => arg === '--scope' || arg.startsWith('--scope=')))
  throw Error('Panel Slicer already selects its own build scope.');
process.argv.push('--scope', 'slicing');
await import('../../../scripts/editor.mjs');
