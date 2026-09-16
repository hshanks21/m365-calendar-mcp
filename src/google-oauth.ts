import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawn } from 'node:child_process';

class BootstrapError extends Error {}

export async function startCallback(options: {port: number; state: string; timeoutMs: number}) {
  let settled = false;
  let consumed = false;
  let resolveCode!: (value: string) => void;
  let rejectCode!: (error: Error) => void;
  const code = new Promise<string>((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  // The caller may still be printing the consent URL when cancellation occurs.
  void code.catch(() => {});
  let timer: NodeJS.Timeout;
  let origin = '';
  const finish = (value?: string, denied = false) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    server.close(() => value === undefined ? rejectCode(new BootstrapError(denied ? 'Google authorization denied.' : 'OAuth callback cancelled or expired.')) : resolveCode(value));
    server.closeAllConnections();
  };
  const server = createServer({maxHeaderSize: 8192}, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Connection', 'close');
    const invalid = () => { res.writeHead(400); res.end('Invalid callback.'); };
    if (settled || consumed || req.method !== 'GET' || req.headers.host !== new URL(origin).host || !req.url?.startsWith('/?') || req.url.length > 4096) return invalid();
    const u = new URL(req.url, origin);
    const q = u.searchParams;
    const state = Buffer.from(q.get('state') ?? '');
    const expected = Buffer.from(options.state);
    if (u.pathname !== '/' || [...new Set(q.keys())].some(k => q.getAll(k).length !== 1) || state.length !== expected.length || !timingSafeEqual(state, expected) || (q.has('error') && q.has('code')) || (!q.get('error') && !q.get('code')) || (q.has('code') && !/^[\x21-\x7e]{1,2048}$/.test(q.get('code')!))) return invalid();
    // No asynchronous work before consuming the one successful callback.
    consumed = true;
    const value = q.get('code') ?? undefined;
    res.on('finish', () => finish(value, q.has('error')));
    res.end('Authorization received. Check the host terminal for secure storage status. You may close this tab.');
  });
  server.on('clientError', (_error, socket) => socket.destroy());
  server.headersTimeout = 5000;
  server.requestTimeout = 5000;
  server.setTimeout(5000, socket => socket.destroy());
  server.maxConnections = 8;
  await new Promise<void>((resolve, reject) => {
    server.once('error', () => reject(new BootstrapError('Cannot bind callback port; choose an unused dedicated port.')));
    server.listen(options.port, '127.0.0.1', () => resolve());
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  timer = setTimeout(() => finish(), options.timeoutMs);
  return {origin, code, cancel: async () => { finish(); await code.catch(() => {}); }};
}


export async function exchangeCode(input: {clientId: string; clientSecret: string; code: string; verifier: string; redirectUri: string}, fetcher: typeof fetch = fetch, timeoutMs = 15000, signal?: AbortSignal): Promise<string> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetcher('https://oauth2.googleapis.com/token', {
      method: 'POST', redirect: 'error', signal: signal ? AbortSignal.any([signal, abort.signal]) : abort.signal,
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({client_id: input.clientId, client_secret: input.clientSecret, code: input.code, code_verifier: input.verifier, redirect_uri: input.redirectUri, grant_type: 'authorization_code'}),
    });
    if (!response.ok || !response.body) throw new BootstrapError();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 16384) throw new BootstrapError();
      chunks.push(chunk);
    }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof data.refresh_token !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(data.refresh_token)) throw new BootstrapError();
    if (typeof data.scope !== 'string') throw new BootstrapError();
    const granted = new Set(data.scope.split(' '));
    if (granted.size !== SCOPES.length || !SCOPES.every(s => granted.has(s))) throw new BootstrapError();
    return data.refresh_token;
  } catch {
    // Never surface provider bodies, fetch errors, codes, or credentials.
    throw new BootstrapError('Google token exchange failed, refresh token missing, or granted scopes differ. No token stored.');
  } finally { clearTimeout(timer); abort.abort(); }
}

// Injection is available only to imported tests, never through CLI/env options.
export function runPrivate(args: string[], input?: string, options: {executable?: string; prefix?: string[]; timeoutMs?: number; signal?: AbortSignal} = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.executable ?? 'doppler', [...(options.prefix ?? []), ...args], {
      cwd: IMPLEMENTATION_CWD, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
      env: {PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8'},
    });
    let output = ''; let size = 0; let failed = false;
    const fail = () => { failed = true; child.kill('SIGKILL'); };
    const timer = setTimeout(fail, options.timeoutMs ?? 20000);
    options.signal?.addEventListener('abort', fail, {once: true});
    if (options.signal?.aborted) fail();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { size += Buffer.byteLength(chunk); if (size > 65536) fail(); else output += chunk; });
    // Drain but never retain/relay diagnostic output, which may contain secrets.
    child.stderr.on('data', chunk => { size += chunk.length; if (size > 65536) fail(); });
    child.stdin.on('error', fail);
    child.on('error', () => { failed = true; });
    child.on('close', status => {
      clearTimeout(timer); options.signal?.removeEventListener('abort', fail);
      if (failed || status !== 0) reject(new BootstrapError('Private Doppler process failed.'));
      else resolve(output);
    });
    child.stdin.end(input);
  });
}

// Pin operations to this executable's checkout, never caller cwd or an env override.
// Source is src/*.ts; the build keeps the same module under dist/src/*.js.
import { fileURLToPath } from 'node:url';
export const IMPLEMENTATION_CWD = fileURLToPath(new URL(import.meta.url.endsWith('.ts') ? '../' : '../../', import.meta.url)).replace(/\/$/, '');
export type PrivateRunner = (args: string[], input?: string) => Promise<string>;
export const DOPPLER_FLAGS = ['--project', 'm365-calendar-mcp', '--config', 'prd', '--scope', IMPLEMENTATION_CWD, '--api-host', 'https://api.doppler.com', '--no-read-env', '--silent', '--no-check-version', '--attempts', '1', '--timeout', '10s'];
export async function storeRefreshToken(token: string, runner: PrivateRunner): Promise<void> {
  try {
    await runner(['secrets', 'set', 'CALENDAR_GOOGLE_REFRESH_TOKEN', '--no-interactive', ...DOPPLER_FLAGS], token);
  } catch {
    throw new BootstrapError('Doppler write failed (possibly a read-only service token or network failure). Nothing exported locally; no permissions changed. Ask the owner to arrange scoped write access, then reauthorize.');
  }
  try {
    const actual = (await runner(['secrets', 'get', 'CALENDAR_GOOGLE_REFRESH_TOKEN', '--plain', '--raw', ...DOPPLER_FLAGS])).replace(/\r?\n$/, '');
    const a = Buffer.from(actual); const b = Buffer.from(token);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new BootstrapError();
  } catch {
    throw new BootstrapError('Doppler write returned success but read-back verification failed. The remote value may have changed; no verified success claimed. Ask the owner to inspect access without printing the token.');
  }
}

export async function runBootstrap(args: string[], env: NodeJS.ProcessEnv, dependencies: {log?: (line: string) => void; fetcher?: typeof fetch; runner?: PrivateRunner; signal?: AbortSignal} = {}): Promise<{ok: boolean; message: string}> {
  const help = 'Usage: npm run google:oauth -- --authorize [--port 8765] [--timeout-seconds 300]. Run from the implementation directory with scoped Doppler injection. See README for the matching SSH tunnel. This explicitly replaces CALENDAR_GOOGLE_REFRESH_TOKEN after consent; --help makes no network requests.';
  if (args.length === 1 && args[0] === '--help') return {ok: true, message: help};
  let callback: Awaited<ReturnType<typeof startCallback>> | undefined;
  const cancel = new AbortController();
  const stop = () => { cancel.abort(); void callback?.cancel(); };
  try {
    if (process.cwd() !== IMPLEMENTATION_CWD) throw new BootstrapError('Run only from the implementation directory.');
    if (args[0] !== '--authorize') throw new BootstrapError(help);
    const values = new Map<string, string>();
    for (let i = 1; i < args.length; i += 2) {
      const key = args[i]; const value = args[i + 1];
      if (!['--port', '--timeout-seconds'].includes(key) || values.has(key) || !value || !/^[0-9]+$/.test(value)) throw new BootstrapError(help);
      values.set(key, value);
    }
    const port = Number(values.get('--port') ?? '8765');
    const timeout = Number(values.get('--timeout-seconds') ?? '300');
    if (!Number.isInteger(timeout) || timeout < 30 || timeout > 900) throw new BootstrapError(help);
    const clientId = env.CALENDAR_GOOGLE_CLIENT_ID ?? '';
    const clientSecret = env.CALENDAR_GOOGLE_CLIENT_SECRET ?? '';
    if (!/^[A-Za-z0-9-]+\.apps\.googleusercontent\.com$/.test(clientId) || !/^[\x21-\x7e]{1,4096}$/.test(clientSecret)) throw new BootstrapError('Missing or invalid Google Desktop client credentials. Use the scoped Doppler injection command in README.');
    const authorization = createAuthorization(clientId, port);
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    dependencies.signal?.addEventListener('abort', stop, {once: true});
    if (dependencies.signal?.aborted) stop();
    if (cancel.signal.aborted) throw new BootstrapError('OAuth cancelled.');
    callback = await startCallback({port, state: authorization.state, timeoutMs: timeout * 1000});
    if (cancel.signal.aborted) { await callback.cancel(); throw new BootstrapError('OAuth cancelled.'); }
    const log = dependencies.log ?? console.log;
    log(`Listening on ${authorization.redirectUri} for up to ${timeout} seconds. Open the following consent URL in your laptop browser with the SSH tunnel active. Sign in manually; do not paste the callback URL or credentials into chat.`);
    log(authorization.url);
    const code = await callback.code;
    const token = await exchangeCode({clientId, clientSecret, code, verifier: authorization.verifier, redirectUri: authorization.redirectUri}, dependencies.fetcher ?? fetch, 15000, cancel.signal);
    if (cancel.signal.aborted) throw new BootstrapError('OAuth cancelled.');
    await storeRefreshToken(token, dependencies.runner ?? ((argv, input) => runPrivate(argv, input, {signal: cancel.signal})));
    return {ok: true, message: 'Refresh token securely stored and read-back verified in m365-calendar-mcp/prd. No calendar events created; Google calendar connector not implemented.'};
  } catch (error) {
    return {ok: false, message: error instanceof BootstrapError ? error.message : 'OAuth bootstrap failed safely. No raw diagnostics or tokens were exported.'};
  } finally {
    await callback?.cancel();
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    dependencies.signal?.removeEventListener('abort', stop);
  }
}

export const SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly'];
export function createAuthorization(clientId: string, port: number) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || [3217, 3218].includes(port)) throw new BootstrapError('Invalid dedicated callback port.');
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const redirectUri = `http://127.0.0.1:${port}/`;
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
  return { url: url.href, state, verifier, redirectUri };
}
