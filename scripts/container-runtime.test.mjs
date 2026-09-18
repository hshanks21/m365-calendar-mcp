import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const image = process.env.CALENDAR_TEST_IMAGE;
assert.ok(image, 'Set CALENDAR_TEST_IMAGE to the locally built image ID or tag');
function probe(source) {
  const result = spawnSync('docker', [
    'run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges:true', '--pids-limit', '128',
    '--memory', '512m', '--cpus', '2',
    '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777',
    '--entrypoint', 'node', '-i', image, '--input-type=module', '-',
  ], { input: source, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test('runtime retains supported Trixie security updates', () => {
  probe(`
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    import { execFileSync } from 'node:child_process';
    assert.match(readFileSync('/etc/os-release', 'utf8'), /^VERSION_CODENAME=trixie$/m);
    for (const [name, minimum] of Object.entries({
      gzip: '1.13-1+deb13u1',
      'libpcre2-8-0': '10.46-1~deb13u2',
      'libsqlite3-0': '3.46.1-7+deb13u2',
      'perl-base': '5.40.1-6+deb13u1',
    })) {
      const version = execFileSync('dpkg-query', ['-W', '-f=\${Version}', name], {encoding:'utf8'});
      execFileSync('dpkg', ['--compare-versions', version, 'ge', minimum]);
    }
  `);
});

test('runtime has no unused bundled npm or npx executable', () => {
  probe(`
    import assert from 'node:assert/strict';
    import { lstatSync } from 'node:fs';
    for (const path of ['/usr/local/lib/node_modules/npm', '/usr/local/bin/npm', '/usr/local/bin/npx']) {
      assert.throws(() => lstatSync(path), {code:'ENOENT'}, path);
    }
  `);
});

test('pruned runtime boots nonroot and serves credential-free liveness without a provider', () => {
  probe(`
    import assert from 'node:assert/strict';
    import { access, readFile } from 'node:fs/promises';
    import { startApplication } from './dist/src/runtime.js';
    assert.equal(process.getuid(), 1000);
    assert.equal(process.getgid(), 1000);
    await access('./deploy/healthcheck.mjs');
    const pkg = JSON.parse(await readFile('./package.json', 'utf8'));
    for (const dependency of Object.keys(pkg.dependencies)) {
      await import(dependency === '@modelcontextprotocol/sdk' ? dependency + '/server/mcp.js' : dependency);
    }
    const service = await startApplication({
      CALENDAR_DASHBOARD_SECRET: 'synthetic-container-test-only-secret',
      CALENDAR_TELEMETRY_FILE: '/tmp/telemetry.json',
    });
    try {
      assert.equal(service.mcp, null);
      const response = await fetch(service.dashboard.url + '/api/diagnostics', {signal:AbortSignal.timeout(3000)});
      assert.equal(response.status, 401);
    } finally { await service.close(); }
  `);
});

test('one immutable runtime accepts operator identity pins and rejects missing/mismatched pins offline', () => {
  probe(`
    import assert from 'node:assert/strict';
    import { loadConfidentialIdentity, createConfidentialClient, confidentialNetwork, createConfidentialToken } from './dist/src/m365-confidential.js';
    import { loadSupabaseIdentity } from './dist/src/supabase-bootstrap.js';
    import { startApplication } from './dist/src/runtime.js';
    const tenant = '44444444-4444-4444-8444-444444444444';
    const clientId = '55555555-5555-4555-8555-555555555555';
    const oid = '66666666-6666-4666-8666-666666666666';
    const username = 'container-owner@example.invalid';
    const env = {
      CALENDAR_M365_MODE: 'delegated-confidential',
      CALENDAR_M365_DELEGATED_TENANT_ID: tenant,
      CALENDAR_M365_DELEGATED_CLIENT_ID: clientId,
      CALENDAR_M365_DELEGATED_ACCOUNT_OBJECT_ID: oid,
      CALENDAR_M365_DELEGATED_EXPECTED_USERNAME: username,
      CALENDAR_M365_DELEGATED_CLIENT_SECRET: 'SYNTHETIC-container-client',
      CALENDAR_M365_DELEGATED_POLICY_JSON: JSON.stringify({calendars:{work:{mailbox:username,calendarId:'SYNTHETIC-work'}},clients:[{id:'container',secret:'SYNTHETIC-caller-'.repeat(3),calendarKeys:['work']}]}),
      CALENDAR_DASHBOARD_SECRET: 'SYNTHETIC-viewer-'.repeat(3),
      CALENDAR_TELEMETRY_FILE: '/tmp/delegated-telemetry.json',
    };
    const c = loadConfidentialIdentity(env);
    const now = Math.floor(Date.now()/1000);
    const jwt = [{alg:'RS256',typ:'JWT'}, {tid:tenant,oid,aud:clientId,iss:c.authority+'/v2.0',sub:'synthetic-sub',preferred_username:username,iat:now,exp:now+3600}].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.')+'.SYNTHETIC';
    const fetcher = async (input, init) => {
      const u = new URL(String(input));
      assert.equal(u.origin, 'https://login.microsoftonline.com');
      if (u.pathname.endsWith('/openid-configuration')) return Response.json({authorization_endpoint:c.authority+'/oauth2/v2.0/authorize',token_endpoint:c.authority+'/oauth2/v2.0/token',issuer:c.authority+'/v2.0',jwks_uri:c.authority+'/discovery/v2.0/keys'});
      assert.equal(u.pathname, '/'+tenant+'/oauth2/v2.0/token');
      assert.equal(new URLSearchParams(String(init.body)).get('client_secret'), env.CALENDAR_M365_DELEGATED_CLIENT_SECRET);
      return Response.json({token_type:'Bearer',scope:'Calendars.ReadBasic',expires_in:3600,access_token:'SYNTHETIC-access',refresh_token:'SYNTHETIC-refresh',id_token:jwt,client_info:Buffer.from(JSON.stringify({uid:oid,utid:tenant})).toString('base64url')});
    };
    const client = createConfidentialClient(c, confidentialNetwork(c, fetcher));
    await client.acquireTokenByRefreshToken({refreshToken:'SYNTHETIC-refresh',scopes:['Calendars.ReadBasic'],forceCache:true});
    env.CALENDAR_M365_DELEGATED_MSAL_CACHE = client.getTokenCache().serialize();
    assert.equal(await createConfidentialToken(env, {fetcher:async()=>assert.fail('saved cache must remain offline')})(), 'SYNTHETIC-access');
    const origin = 'https://zyxwvutsrqponmlkjihg.supabase.co';
    assert.equal(loadSupabaseIdentity({...env,CALENDAR_SUPABASE_ALLOWED_ORIGIN:origin,CALENDAR_SUPABASE_URL:origin,CALENDAR_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_SYNTHETIC-only'}).supabaseOrigin, origin);
    for (const value of [undefined, '', 'invalid', 'other@example.invalid']) {
      await assert.rejects(async()=> {
        const s = await startApplication({...env,CALENDAR_M365_DELEGATED_EXPECTED_USERNAME:value});
        await s.close();
      });
    }
    const service = await startApplication(env);
    try {
      assert.ok(service.mcp);
      assert.equal((await fetch(service.dashboard.url+'/api/diagnostics')).status,401);
      assert.equal((await fetch(service.mcp.url,{headers:{Origin:'http://evil.invalid'}})).status,403);
    } finally { await service.close(); }
  `);
});
