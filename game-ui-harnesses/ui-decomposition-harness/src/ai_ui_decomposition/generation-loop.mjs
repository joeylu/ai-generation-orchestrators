/** Host-injected serial tool loop. No filesystem, provider or credential defaults. */
const requireValue = (ok, code) => { if (!ok) throw new Error(code); };

/** Opt-in transport batching; critical events always await durable storage. */
export function batchedLoopPersistence(writeBatch) {
  requireValue(typeof writeBatch === 'function', 'LOOP_HOST_REQUIRED');
  let pending=[], failed=false;
  const buffered=new Set(['exchange','result-ready']);
  return async event=>{
    requireValue(!failed,'LOOP_JOURNAL_FAILED');
    pending.push(event);
    if(buffered.has(event.event)) return;
    const batch={kind:'ui_generation_loop_events_v1',events:pending};
    try {await writeBatch(batch);pending=[];}
    catch(error) {failed=true;throw error;}
  };
}

export function builtinResultPath(result, allowedDirectory, rootMode='direct') {
  requireValue(['direct','session-child'].includes(rootMode),'LOOP_ROOT_MODE');
  // Observed built-in transport hint, not a promised provider schema. Fail closed.
  requireValue(result && typeof result.image_url === 'string' &&
    result.image_url.startsWith('data:image/png;base64,'), 'LOOP_PNG_RESULT_REQUIRED');
  requireValue(typeof result.output_hint === 'string', 'LOOP_PATH_HINT_REQUIRED');
  const matches = [...result.output_hint.matchAll(/ as ([^\r\n]+\.png) by default\./g)];
  requireValue(matches.length === 1, 'LOOP_PATH_HINT_AMBIGUOUS');
  const raw = matches[0][1];
  requireValue(!/[\x00-\x1f]/.test(raw), 'LOOP_PATH_INVALID');
  const normalize = value => value.replaceAll('\\', '/').replace(/\/$/, '');
  const path = normalize(raw), root = normalize(allowedDirectory);
  const absolute = value => /^(?:[A-Za-z]:\/|\/)/.test(value) && !value.startsWith('//');
  requireValue(absolute(path) && absolute(root) && root.length > 3,
    'LOOP_ABSOLUTE_PATH_REQUIRED');
  requireValue(!path.split('/').some(x => x === '..' || x === '.') &&
    !root.split('/').some(x => x === '..' || x === '.'), 'LOOP_PATH_TRAVERSAL');
  // Restrict to a direct child of the caller-verified output directory.
  const parent=path.slice(0,path.lastIndexOf('/'));
  requireValue(rootMode==='direct'?parent===root:
    parent.startsWith(root+'/') && /^[^/:]+$/.test(parent.slice(root.length+1)), 'LOOP_PATH_OUTSIDE_ROOT');
  requireValue(/^[^/:]+\.png$/.test(path.slice(path.lastIndexOf('/') + 1)), 'LOOP_PATH_INVALID');
  return raw;
}

export async function runGenerationLoop({maxCalls, exchange, generate, resolveResult,
    persist, progress = async () => {}, cancelled = () => false,
    now = () => Date.now(), schedule, unschedule, initialPrevious = null}) {
  requireValue(Number.isInteger(maxCalls) && maxCalls >= (initialPrevious ? 0 : 1) && maxCalls <= 32, 'LOOP_BUDGET');
  requireValue([exchange, generate, resolveResult, persist].every(x => typeof x === 'function'),
    'LOOP_HOST_REQUIRED');
  requireValue((schedule === undefined) === (unschedule === undefined), 'LOOP_TIMER_PAIR');
  const seen = new Set(); const started = now();
  if(initialPrevious) {
    requireValue(/^[0-9a-f]{64}$/.test(initialPrevious.requestDigest) && typeof initialPrevious.source==='string' && initialPrevious.source.length>0,'LOOP_RECOVERY_INPUT');
    seen.add(initialPrevious.requestDigest);
  }
  let previous = initialPrevious, calls = 0, current = null;
  const elapsed = () => Math.max(0, now() - started);
  try {
    for (;;) {
      requireValue(!cancelled(), 'LOOP_CANCELLED');
      const exchangeStart = now();
      const result = await exchange(previous);
      await persist({event:'exchange', calls, elapsedMs:elapsed(),
        durationMs:Math.max(0, now()-exchangeStart), result});
      previous = null;
      if (!result.nextRequest) {
        await persist({event:'stopped', calls, elapsedMs:elapsed(), status:result.status});
        return {calls, status:result.status, elapsedMs:elapsed()};
      }
      current = result.nextRequest;
      requireValue(calls < maxCalls, 'LOOP_BUDGET_EXHAUSTED');
      requireValue(typeof current.requestDigest === 'string' && /^[0-9a-f]{64}$/.test(current.requestDigest),
        'LOOP_REQUEST_DIGEST');
      requireValue(!seen.has(current.requestDigest), 'LOOP_DUPLICATE_REQUEST');
      requireValue(current.arguments && typeof current.arguments.prompt === 'string', 'LOOP_ARGUMENTS');
      seen.add(current.requestDigest);
      requireValue(!cancelled(), 'LOOP_CANCELLED');
      await persist({event:'invocation-intent', call:calls+1, request:current, elapsedMs:elapsed()});
      requireValue(!cancelled(), 'LOOP_CANCELLED');
      calls++;
      await progress({event:'generation-start', call:calls, asset:current.asset});
      const toolStart = now();
      let timer;
      const tick = () => {
        Promise.resolve(progress({event:'generation-wait', call:calls, asset:current.asset,
          elapsedMs:Math.max(0, now()-toolStart)})).catch(() => {});
        timer = schedule(tick, 30000);
      };
      if (schedule) timer = schedule(tick, 30000);
      let raw;
      try { raw = await generate(current.arguments); }
      finally { if (timer !== undefined) unschedule(timer); }
      const toolMs = Math.max(0, now()-toolStart);
      // Keep the actual tool response before resolving its path or receiving it.
      await persist({event:'tool-returned', call:calls, requestDigest:current.requestDigest,
        toolMs, response:raw, elapsedMs:elapsed()});
      const source = await resolveResult(raw);
      requireValue(typeof source === 'string' && source.length > 0, 'LOOP_RESULT_PATH_REQUIRED');
      previous = {requestDigest:current.requestDigest, source};
      await persist({event:'result-ready', call:calls, ...previous, toolMs, elapsedMs:elapsed()});
      await progress({event:'generation-received', call:calls, asset:current.asset, toolMs});
      // Cancellation here preserves the returned image but dispatches no next request.
    }
  } catch (error) {
    await persist({event:'interrupted', calls, requestDigest:current?.requestDigest ?? null,
      elapsedMs:elapsed(), automaticResubmit:false});
    throw error;
  }
}
