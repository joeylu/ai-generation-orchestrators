// Deterministic local sample, explicitly labelled as a fixture in the editor.
export async function sliceSamplePng() {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 192;
  const c = canvas.getContext('2d');
  c.fillStyle = '#163445'; c.strokeStyle = '#62d8c3'; c.lineWidth = 4;
  c.beginPath(); c.roundRect(4, 4, 248, 184, 26); c.fill(); c.stroke();
  c.strokeStyle = '#307568'; c.lineWidth = 1;
  c.beginPath(); c.roundRect(12, 12, 232, 168, 20); c.stroke();
  return new Uint8Array(await (await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))).arrayBuffer());
}
