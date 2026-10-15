import { mkdir, writeFile, readFile, lstat } from 'node:fs/promises';
import { join, resolve, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, json, readSafe } from '../skins/package.mjs';
import { decodePng } from '../skins/png.mjs';
import { verifyGenerationPlan } from './plan.mjs';

const fail = message => { throw Object.assign(Error(message), { code: 'skin.attempt' }); };
async function noLinks(path) {
  let current = parse(resolve(path)).root;
  for (const part of resolve(path).slice(current.length).split(/[\\/]/).filter(Boolean)) {
    current = join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) fail('Links/junctions are forbidden.'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
}
async function frozenPlan(directory, planSha256) {
  if (!/^[a-f0-9]{64}$/.test(planSha256)) fail('Invalid reviewed plan digest.');
  const bytes = await readSafe(directory, 'plan.json');
  if (hash(bytes) !== planSha256) fail('Plan changed.');
  const plan = JSON.parse(bytes);
  if (plan.kind !== 'ui_skin_generation_plan' || plan.version !== '0.1') fail('Invalid plan.');
  for (const f of plan.resources) {
    const b = await readSafe(directory, f.file);
    if (b.length !== f.bytes || hash(b) !== f.sha256) fail('Frozen input changed.');
  }
  return plan;
}

/** Caller must have an explicit human confirmation of this exact digest.
 * One pilot submission per plan. This never calls a provider or invents an outcome.
 * A reservation without a receipt must not be reused, including after a crash.
 */
export async function reserveAttempt({ planDirectory, planSha256, output, confirmedPlanSha256, contracts, batchBinding }) {
  if (confirmedPlanSha256 !== planSha256) fail('Fresh human-confirmed plan digest is required.');
  await verifyGenerationPlan({ directory: planDirectory, planSha256, contracts });
  await noLinks(output); await mkdir(output, { recursive: true });
  const directory = join(output, planSha256);
  await noLinks(directory);
  try { await mkdir(directory); }
  catch (e) { if (e.code === 'EEXIST') fail('This pilot plan already has a reservation; do not submit it again.'); throw e; }
  const program = await readFile(fileURLToPath(import.meta.url));
  const reservation = { kind: 'ui_skin_external_attempt_reservation', version: '0.1', planSha256,
    ...(batchBinding ? {batchBinding} : {}),
    authorization: { basis: 'explicit-human-confirmation-supplied-by-caller', maxSubmissions: 1, consumed: true },
    state: 'reserved-for-external-submission', outcome: 'unknown', createdAt: new Date().toISOString(),
    automaticRetry: false, programSha256: hash(program) };
  await writeFile(join(directory, 'reservation.json'), json(reservation), { flag: 'wx' });
  return { directory, planSha256, state: reservation.state, automaticRetry: false };
}

export function assessPilot(bytes, plan) {
  let image;
  try { image = decodePng(bytes); }
  catch (e) { return { status: 'rejected', issues: [{ code: 'png.unsupported', message: e.code === 'skin.png' ? e.message : 'PNG decode failed.' }], visualAcceptance: 'unreviewed', productionReady: false }; }
  const { width, height, pixels } = image, issues = [];
  const dimensionsMatch = width === plan.request.width && height === plan.request.height;
  if (!dimensionsMatch) issues.push({ code: 'dimensions', expected: [plan.request.width, plan.request.height], actual: [width, height] });
  const occupancy = new Uint8Array(width * height);
  const outputScale = plan.outputScale ?? 1;
  const parts = [];
  for (const part of plan.parts) {
    const [x,y,w,h] = part.bodyRect.map(v => v * outputScale);
    let visiblePixels = 0;
    for (let row = Math.max(0,y); row < Math.min(height,y+h); row++) for (let col = Math.max(0,x); col < Math.min(width,x+w); col++) {
      const i = row * width + col; occupancy[i] = 1; if (pixels[i*4+3]) visiblePixels++;
    }
    parts.push({ assetId: part.assetId, expectedBodyRect: [x,y,w,h], visiblePixelsInsideExpectedBody: visiblePixels });
    if (!visiblePixels) issues.push({ code: 'empty-body', assetId: part.assetId });
  }
  let outsideBodyPixels = 0, transparentPixels = 0, partialAlphaPixels = 0, opaquePixels = 0;
  for (let i=0; i<occupancy.length; i++) {
    const a = pixels[i*4+3]; if (!a) transparentPixels++; else { if (a===255) opaquePixels++; else partialAlphaPixels++; if (!occupancy[i]) outsideBodyPixels++; }
  }
  if (outsideBodyPixels) issues.push({ code: 'outside-body', pixels: outsideBodyPixels });
  if (!transparentPixels) issues.push({ code: 'alpha.opaque-background' });
  // Diagnostic connected silhouettes only; never used to infer or repair crop coordinates.
  const visited = new Uint8Array(width * height), queue = new Int32Array(width * height), silhouettes = [];
  for (let start=0; start<visited.length; start++) {
    if (visited[start] || !pixels[start*4+3]) continue;
    let head=0, tail=1, x0=width, y0=height, x1=0, y1=0; queue[0]=start; visited[start]=1;
    while(head<tail) {
      const i=queue[head++], x=i%width, y=Math.floor(i/width); x0=Math.min(x0,x); y0=Math.min(y0,y); x1=Math.max(x1,x); y1=Math.max(y1,y);
      for(const next of [x>0?i-1:-1,x+1<width?i+1:-1,y>0?i-width:-1,y+1<height?i+width:-1]) if(next>=0&&!visited[next]&&pixels[next*4+3]) { visited[next]=1; queue[tail++]=next; }
    }
    if(tail>=8) silhouettes.push({ bounds:[x0,y0,x1-x0+1,y1-y0+1], visiblePixels:tail });
  }
  return { status: issues.length ? 'rejected' : 'pixel-gates-passed-awaiting-visual-review', width, height, dimensionsMatch,
    transparentPixels, partialAlphaPixels, opaquePixels, transparentRgbPixels: image.transparentRgbPixels,
    outsideBodyPixels, parts, silhouettes, issues, semanticIdentity: 'not-automatically-verified', visualAcceptance: 'unreviewed', productionReady: false };
}

/** Copy the exact returned bytes and write a deterministic inspection; never normalizes an image. */
export async function receiveAttempt({ planDirectory, planSha256, directory, raw }) {
  const reservationBytes = await readSafe(directory, 'reservation.json');
  const reservation = JSON.parse(reservationBytes);
  if (reservation.kind !== 'ui_skin_external_attempt_reservation' || reservation.planSha256 !== planSha256) fail('Reservation mismatch.');
  const plan = await frozenPlan(planDirectory, planSha256);
  await noLinks(raw);
  const stat = await lstat(raw);
  if (!stat.isFile() || stat.size < 1 || stat.size > 32*1024*1024) fail('Raw result must be a bounded regular file.');
  const bytes = await readFile(raw);
  if(reservation.batchBinding){
    const submissionBytes=await readSafe(directory,'submission.json'),submission=JSON.parse(submissionBytes);
    const resultBytes=await readSafe(directory,'external-result.json'),result=JSON.parse(resultBytes);
    if(submission.planSha256!==planSha256||submission.reservationSha256!==hash(reservationBytes)||result.submissionSha256!==hash(submissionBytes))fail('Batch return is not bound to this submission and raw result.');
    if(result.status==='indeterminate') {
      const {verifyRecoveredResult}=await import('./recovered-result.mjs');
      verifyRecoveredResult(await readSafe(directory,'recovered-result.json'),{resultBytes,submissionBytes,planSha256,rawSha256:hash(bytes)});
    } else if(result.status!=='returned'||result.rawSha256!==hash(bytes))fail('Batch return is not bound to this submission and raw result.');
  }
  await noLinks(directory);
  // Exclusive claim makes interrupted reception inspectable, not silently repeatable.
  await writeFile(join(directory, 'receive.claim'), json({ rawSha256: hash(bytes), bytes: bytes.length }), { flag: 'wx' });
  await writeFile(join(directory, 'raw.png'), bytes, { flag: 'wx' });
  const geometry = JSON.parse(await readSafe(planDirectory, 'geometry.json'));
  const inspection = assessPilot(bytes, { ...plan, outputScale: geometry.coordinates.outputScale });
  const reportBytes = Buffer.from(json({ kind: 'ui_skin_pilot_inspection', version: '0.1', planSha256, rawSha256: hash(bytes), ...inspection }));
  await writeFile(join(directory, 'inspection.json'), reportBytes, { flag: 'wx' });
  const receipt = { kind: 'ui_skin_external_attempt_receipt', version: '0.1', planSha256,
    reservationSha256: hash(reservationBytes), state: 'received', receivedAt: new Date().toISOString(),
    raw: { file: 'raw.png', sha256: hash(bytes), bytes: bytes.length },
    inspection: { file: 'inspection.json', sha256: hash(reportBytes), status: inspection.status },
    automaticRetry: false, visualAcceptance: 'unreviewed', productionReady: false };
  await writeFile(join(directory, 'receipt.json'), json(receipt), { flag: 'wx' });
  return { state: receipt.state, ...inspection, rawSha256: hash(bytes) };
}
