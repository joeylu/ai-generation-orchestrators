/** Accept only browser requests from the same numeric loopback origin. */
function header(request, name) { const value = request.headers?.[name]; return typeof value === 'string' ? value : undefined; }
function sameOrigin(value, host, originForm) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' && !parsed.username && !parsed.password && parsed.host === host
      && (!originForm || (parsed.pathname === '/' && !parsed.search && !parsed.hash));
  } catch { return false; }
}
export function isTrustedLocalRequest(request) {
  const host = header(request, 'host'); let parsed;
  try {
    parsed = new URL(`http://${host}`);
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash
      || !['127.0.0.1', '[::1]'].includes(parsed.hostname)) return false;
  } catch { return false; }
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket?.remoteAddress)) return false;
  const origin = header(request, 'origin');
  if (origin) return sameOrigin(origin, parsed.host, true);
  return request.method === 'GET' && header(request, 'sec-fetch-site') === 'same-origin'
    && sameOrigin(header(request, 'referer') ?? '', parsed.host, false);
}
