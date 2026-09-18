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
