import { test, expect } from '@playwright/test';
test('raw pixels apply crop, flips, each quarter-turn, nonuniform scale and offset in contract order', async ({ page }) => {
  await page.goto('/reference-acceptance.html');
  const results = await page.evaluate(async () => {
    const { mappedReference } = await import('/src/reference-visual.ts');
    const source = document.createElement('canvas'); source.width = 5; source.height = 4; const ctx = source.getContext('2d')!;
    const colors = ['#ff0000', '#00ff00', '#0000ff', '#00ffff', '#ff00ff', '#ffff00'];
    for (let i = 0; i < 6; i++) { ctx.fillStyle = colors[i]; ctx.fillRect(1 + i % 3, 1 + Math.floor(i / 3), 1, 1); }
    const base64 = source.toDataURL('image/png').split(',')[1];
    const cases = [
      { rotationDegrees: 0, flipX: false, flipY: false, expected: [[0,1,2],[3,4,5]] },
      { rotationDegrees: 90, flipX: false, flipY: false, expected: [[3,0],[4,1],[5,2]] },
      { rotationDegrees: 180, flipX: false, flipY: false, expected: [[5,4,3],[2,1,0]] },
      { rotationDegrees: 270, flipX: false, flipY: false, expected: [[2,5],[1,4],[0,3]] },
      { rotationDegrees: 0, flipX: true, flipY: false, expected: [[2,1,0],[5,4,3]] },
      { rotationDegrees: 0, flipX: false, flipY: true, expected: [[3,4,5],[0,1,2]] },
      { rotationDegrees: 90, flipX: true, flipY: false, expected: [[5,2],[4,1],[3,0]] },
      { rotationDegrees: 270, flipX: true, flipY: true, expected: [[3,0],[4,1],[5,2]] },
    ];
    const out = [];
    for (const item of cases) {
      const mapping = { coordinateSpace: 'raw-image-pixel-edges-to-runtime-canvas', sourceSize: [5,4], targetSize: [16,16], crop: [1,1,3,2], rotationDegrees: item.rotationDegrees, flipX: item.flipX, flipY: item.flipY, scale: [3,3], offset: [2,1] };
      mapping.scale = [3, 5]; mapping.targetSize = [20,20];
      const evidence: any = { status: 'complete', manifest: { original: { path: 'reference/original.png', width: 5, height: 4 }, mapping, derivatives: [] }, files: [{ path: 'reference/original.png', base64 }] };
      const result = await mappedReference(evidence), pixels = result.getContext('2d')!;
      const actual = item.expected.map((row, y) => row.map((_, x) => [...pixels.getImageData(2 + x * 3 + 1, 1 + y * 5 + 2, 1, 1).data]));
      const expected = item.expected.map(row => row.map(n => [...colors[n].slice(1).match(/../g)!.map(s => parseInt(s, 16)),255]));
      out.push({ actual, expected, outsideAlpha: pixels.getImageData(0,0,1,1).data[3] });
    }
    return out;
  });
  for (const result of results) { expect(result.actual).toEqual(result.expected); expect(result.outsideAlpha).toBe(0); }
});
