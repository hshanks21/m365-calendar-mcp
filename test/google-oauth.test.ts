// SYNTHETIC FIXTURES ONLY. No real Google or Doppler requests/credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { request, createServer } from 'node:http';
import { once } from 'node:events';
function httpCall(url: string, method = 'GET', headers = {}): Promise<{status: number, body: string, headers: any}> {
  return new Promise((resolve, reject) => {
    const req = request(url, {method, headers}, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', c => body += c);
      res.on('end', () => resolve({status: res.statusCode!, body, headers: res.headers}));
    });
    req.on('error', reject); req.end();
  });
}
const load = async (): Promise<any> => import('../src/google-oauth.js').catch(() => ({}));
test('synthetic OAuth: fresh state and S256 authorize only the approved scopes', async () => {
  const m = await load();
  assert.equal(typeof m.createAuthorization, 'function');
  const a = m.createAuthorization('synthetic.apps.googleusercontent.com', 8765);
  const b = m.createAuthorization('synthetic.apps.googleusercontent.com', 8765);
  const u = new URL(a.url);
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(u.searchParams.get('scope'), 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly');
  assert.equal(u.searchParams.get('redirect_uri'), 'http://127.0.0.1:8765/');
  assert.equal(u.searchParams.get('access_type'), 'offline');
  assert.equal(u.searchParams.get('prompt'), 'consent');
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('code_challenge'), createHash('sha256').update(a.verifier).digest('base64url'));
  assert.match(a.verifier, /^[\w-]{43,128}$/);
  assert.match(a.state, /^[\w-]{43}$/);
  assert.notEqual(a.state, b.state);
  assert.notEqual(a.verifier, b.verifier);
  assert.equal(u.searchParams.has('client_secret'), false);
  assert.equal(a.url.includes(a.verifier), false);
  for (const port of [0, 3217, 3218, 80, 65536, 1.5]) assert.throws(() => m.createAuthorization('synthetic.apps.googleusercontent.com', port));
});

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
test('CLI help works without credentials and explicit consent opt-in is mandatory', () => {
  const entry = new URL('../src/google-oauth-cli.ts', import.meta.url);
  const filename = existsSync(entry) ? entry.pathname : new URL('../src/google-oauth-cli.js', import.meta.url).pathname;
  const run = (args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', filename, ...args], {encoding: 'utf8', env: {PATH: process.env.PATH, HOME: process.env.HOME}});
  const help = run(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--authorize/);
  assert.equal(run([]).status, 1);
  const missing = run(['--authorize']);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /credentials/);
  assert.equal(missing.stdout.includes('accounts.google.com'), false);
});

test('synthetic bootstrap completes callback to exchange to verified storage; bad inputs never start consent', async () => {
  const m = await load();
  assert.equal(typeof m.runBootstrap, 'function');
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = (probe.address() as import('node:net').AddressInfo).port;
  await new Promise<void>(r => probe.close(() => r()));
  const logs: string[] = []; let requests = 0; let stored = '';
  let callback: Promise<any> | undefined;
  const env = {CALENDAR_GOOGLE_CLIENT_ID: 'synthetic.apps.googleusercontent.com', CALENDAR_GOOGLE_CLIENT_SECRET: 'synthetic-secret'};
  const dependencies = {
    log: (line: string) => { logs.push(line); if (line.startsWith('https://accounts.google.com/')) {const u = new URL(line); callback = httpCall(u.searchParams.get('redirect_uri')! + '?state=' + u.searchParams.get('state') + '&code=synthetic-code');} },
    fetcher: async (_url: any, init: any) => {requests++; assert.equal(init.body.get('code'), 'synthetic-code'); return new Response(JSON.stringify({refresh_token: 'synthetic-refresh', scope: m.SCOPES.join(' ')}));},
    runner: async (args: string[], input?: string) => {if (args.includes('set')) stored = input!; return args.includes('get') ? stored : '';},
  };
  const result = await m.runBootstrap(['--authorize', '--port', String(port)], env, dependencies);
  await callback;
  assert.equal(result.ok, true); assert.equal(requests, 1); assert.equal(stored, 'synthetic-refresh');
  assert.equal(/synthetic-(secret|code|refresh)/.test(logs.join('\n') + result.message), false);
  await assert.rejects(httpCall(`http://127.0.0.1:${port}/`));
  for (const args of [[], ['--authorize', '--port', '3217'], ['--authorize', '--unknown'], ['--authorize', '--timeout-seconds', '0'], ['--authorize', '--port', '8765', '--port', '8766']]) {
    logs.length = 0;
    assert.equal((await m.runBootstrap(args, env, dependencies)).ok, false);
    assert.equal(logs.length, 0);
  }
  assert.equal((await m.runBootstrap(['--authorize'], {}, dependencies)).ok, false);
  assert.equal((await m.runBootstrap(['--help'], {}, dependencies)).ok, true);
});

test('synthetic bootstrap cancellation closes callback and removes signal listeners without upstream calls', async () => {
  const m = await load();
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = (probe.address() as import('node:net').AddressInfo).port;
  await new Promise<void>(r => probe.close(() => r()));
  const controller = new AbortController();
  const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
  const result = await m.runBootstrap(['--authorize', '--port', String(port)], {CALENDAR_GOOGLE_CLIENT_ID: 'synthetic.apps.googleusercontent.com', CALENDAR_GOOGLE_CLIENT_SECRET: 'synthetic-secret'}, {
    signal: controller.signal,
    log: () => controller.abort(),
    fetcher: () => {assert.fail('No token request on cancellation');},
    runner: () => {assert.fail('No storage on cancellation');},
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /cancelled/);
  assert.deepEqual([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')], before);
  await assert.rejects(httpCall(`http://127.0.0.1:${port}/`));
});

test('synthetic child process uses private pipes, scoped cwd, bounded output and safe errors', async () => {
  const m = await load();
  assert.equal(typeof m.runPrivate, 'function');
  const fixture = `let s=''; process.stdin.on('data', c=>s+=c); process.stdin.on('end',()=>{if(process.cwd() !== ${JSON.stringify(process.cwd())} || Object.keys(process.env).some(k=>k.startsWith('CALENDAR_')||k.startsWith('DOPPLER_'))) process.exit(2); process.stderr.write('synthetic-private-stderr'); process.stdout.write(s);});`;
  assert.equal(await m.runPrivate([], 'synthetic-private-stdin', {executable: process.execPath, prefix: ['-e', fixture]}), 'synthetic-private-stdin');
  for (const script of ["process.stderr.write('synthetic-private-stderr'); process.exit(1)", "process.stdout.write('x'.repeat(70000))", 'setInterval(()=>{},1000)']) {
    await assert.rejects(m.runPrivate([], undefined, {executable: process.execPath, prefix: ['-e', script], timeoutMs: 100}), (e: Error) => e.message === 'Private Doppler process failed.');
  }
});

test('synthetic Doppler adapter writes only refresh key via stdin and verifies internal exact readback', async () => {
  const m = await load();
  assert.equal(typeof m.storeRefreshToken, 'function');
  const calls: any[] = [];
  const runner = async (args: string[], input: string | undefined) => {
    calls.push({args, input});
    assert.ok(args.includes('--project') && args.includes('m365-calendar-mcp'));
    assert.ok(args.includes('--config') && args.includes('prd'));
    assert.ok(args.includes('--no-read-env'));
    assert.ok(args.includes('--silent'));
    assert.equal(args.includes('synthetic-refresh'), false);
    return args.includes('get') ? 'synthetic-refresh\n' : '';
  };
  await m.storeRefreshToken('synthetic-refresh', runner);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].args.includes('set') && calls[0].args.includes('--no-interactive'));
  assert.equal(calls[0].input, 'synthetic-refresh');
  assert.ok(calls[1].args.includes('get') && calls[1].args.includes('--plain') && calls[1].args.includes('--raw'));
  assert.equal(calls[1].input, undefined);
  for (const c of calls) assert.equal(c.args.filter((s: string) => s.startsWith('CALENDAR_')).join(), 'CALENDAR_GOOGLE_REFRESH_TOKEN');
  await assert.rejects(m.storeRefreshToken('synthetic-refresh', async () => {throw new Error('403 synthetic-refresh synthetic-secret');}), (e: Error) => /read-only/.test(e.message) && !/synthetic-/.test(e.message));
  await assert.rejects(m.storeRefreshToken('synthetic-refresh', async () => 'wrong'), /verification/);
});

test('synthetic token HTTP fixture exercises official adapter, PKCE body, scoped grant and sanitized failures', async () => {
  const m = await load();
  assert.equal(typeof m.exchangeCode, 'function');
  let mode = 'ok';
  const fixture = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const q = new URLSearchParams(body);
    assert.equal(req.method, 'POST');
    assert.equal(q.get('client_secret'), 'synthetic-secret');
    assert.equal(q.get('code'), 'synthetic-code');
    assert.equal(q.get('code_verifier'), 'synthetic-verifier');
    assert.equal(q.get('grant_type'), 'authorization_code');
    assert.equal(q.get('redirect_uri'), 'http://127.0.0.1:8765/');
    if (mode === 'hang') return;
    if (mode === 'redirect') { res.writeHead(302, {location: '/leak'}); res.end(); return; }
    if (mode === 'error') { res.writeHead(400); res.end('synthetic-secret synthetic-code'); return; }
    res.setHeader('Content-Type', 'application/json');
    if (mode === 'oversize') { res.end('x'.repeat(20000)); return; }
    res.end(JSON.stringify({refresh_token: mode === 'missing' ? undefined : 'synthetic-refresh', access_token: 'synthetic-access', scope: mode === 'partial' ? m.SCOPES[0] : m.SCOPES.join(' ')}));
  });
  fixture.listen(0, '127.0.0.1'); await once(fixture, 'listening');
  const addr = fixture.address() as import('node:net').AddressInfo;
  const fixtureFetch: typeof fetch = (url, init) => {
    assert.equal(url, 'https://oauth2.googleapis.com/token');
    assert.equal(init?.redirect, 'error');
    assert.equal(String(url).includes('synthetic-secret'), false);
    return fetch(`http://127.0.0.1:${addr.port}/token`, init);
  };
  const input = {clientId: 'synthetic.apps.googleusercontent.com', clientSecret: 'synthetic-secret', code: 'synthetic-code', verifier: 'synthetic-verifier', redirectUri: 'http://127.0.0.1:8765/'};
  try {
    assert.equal(await m.exchangeCode(input, fixtureFetch, 500), 'synthetic-refresh');
    for (mode of ['error', 'redirect', 'partial', 'missing', 'oversize', 'hang']) {
      await assert.rejects(m.exchangeCode(input, fixtureFetch, 50), (e: Error) => {
        assert.equal(/synthetic-(secret|code|refresh|access)/.test(e.message), false);
        return true;
      });
    }
  } finally { fixture.closeAllConnections(); await new Promise<void>(r => fixture.close(() => r())); }
});

test('synthetic callback denial terminates promptly; expiry/cancel/busy ports clean up', async () => {
  const m = await load();
  const denied = await m.startCallback({port: 0, state: 'synthetic-state', timeoutMs: 1000});
  const started = Date.now();
  await httpCall(denied.origin + '/?state=synthetic-state&error=access_denied&error_description=DO-NOT-LOG');
  await assert.rejects(denied.code, /denied/);
  assert.ok(Date.now() - started < 500);
  await assert.rejects(httpCall(denied.origin));
  const expired = await m.startCallback({port: 0, state: 's', timeoutMs: 20});
  await assert.rejects(expired.code, /expired/);
  await assert.rejects(httpCall(expired.origin));
  const cancelled = await m.startCallback({port: 0, state: 's', timeoutMs: 1000});
  await assert.rejects(m.startCallback({port: Number(new URL(cancelled.origin).port), state: 's', timeoutMs: 1000}), /bind/);
  await cancelled.cancel();
  await assert.rejects(httpCall(cancelled.origin));
});

test('synthetic loopback callback accepts one code only after strict validation and closes', async () => {
  const m = await load();
  assert.equal(typeof m.startCallback, 'function');
  const c = await m.startCallback({port: 0, state: 'synthetic-state', timeoutMs: 2000});
  try {
    for (const [path, method, headers] of [
      ['/?state=wrong&code=synthetic-code', 'GET', {}],
      ['/other?state=synthetic-state&code=synthetic-code', 'GET', {}],
      ['/?state=synthetic-state&code=synthetic-code', 'POST', {}],
      ['/?state=synthetic-state&code=synthetic-code', 'GET', {Host: 'evil.invalid'}],
      ['/?state=synthetic-state&state=synthetic-state&code=synthetic-code', 'GET', {}],
      ['/?state=synthetic-state&code=one&code=two', 'GET', {}],
      ['/?state=synthetic-state&code=%0A', 'GET', {}],
      ['/?state=synthetic-state&code=one&error=access_denied', 'GET', {}],
    ] as const) {
      const r = await httpCall(c.origin + path, method, headers);
      assert.ok(r.status >= 400);
      assert.equal(r.body.includes('synthetic-code'), false);
    }
    const r = await httpCall(c.origin + '/?state=synthetic-state&code=synthetic-code&scope=ignored');
    assert.equal(r.status, 200);
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.equal(r.headers['referrer-policy'], 'no-referrer');
    assert.equal(r.body.includes('synthetic-code'), false);
    assert.equal(await c.code, 'synthetic-code');
    await assert.rejects(httpCall(c.origin + '/?state=synthetic-state&code=replay'));
  } finally { await c.cancel(); }
});
