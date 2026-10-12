import { it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

const connection = {
  DATABASE_URL: 'postgresql://survey_admin_app:fixture@127.0.0.1:15432/railway',
  S3_ENDPOINT: 'https://storage.example.invalid', S3_BUCKET: 'fixture',
  S3_ACCESS_KEY: 'fixture', S3_SECRET_KEY: 'fixture',
};

it.skipIf(process.platform === 'win32')('keeps malformed local connection secrets out of startup errors', () => {
  const root = mkdtempSync(join(tmpdir(), 'survey-local-secret-'));
  try {
    for (const dir of ['scripts', '.venv/bin', '.local']) mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, 'scripts/admin-local.mjs'), readFileSync('scripts/admin-local.mjs'));
    writeFileSync(join(root, '.venv/bin/python'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    writeFileSync(join(root, '.local/admin-production.json'), '{"S3_SECRET_KEY":fixture_secret}');
    const result = spawnSync(process.execPath, [join(root, 'scripts/admin-local.mjs')], { encoding: 'utf8', env: { PATH: process.env.PATH } });
    expect(result.status).not.toBe(0);
    expect(result.stderr).not.toContain('fixture_sec');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it.skipIf(process.platform === 'win32')('keeps malformed Railway variable secrets out of setup errors', () => {
  const root = mkdtempSync(join(tmpdir(), 'survey-setup-secret-'));
  try {
    for (const dir of ['scripts', 'bin']) mkdirSync(join(root, dir));
    writeFileSync(join(root, 'scripts/admin-connect.mjs'), readFileSync('scripts/admin-connect.mjs'));
    writeFileSync(join(root, 'bin/railway'), '#!/bin/sh\nprintf \'%s\' \'{"S3_SECRET_KEY":fixture_secret}\'\n', { mode: 0o755 });
    const result = spawnSync(process.execPath, [join(root, 'scripts/admin-connect.mjs')], {
      encoding: 'utf8', env: { PATH: join(root, 'bin') + delimiter + process.env.PATH },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).not.toContain('fixture_sec');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it.skipIf(process.platform === 'win32')('starts the local server without automatically migrating the shared production database', () => {
  const root = mkdtempSync(join(tmpdir(), 'survey-local-launch-'));
  try {
    for (const dir of ['scripts', 'server', '.venv/bin', '.local', 'dist/admin']) mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, 'scripts/admin-local.mjs'), readFileSync('scripts/admin-local.mjs'));
    writeFileSync(join(root, '.local/admin-production.json'), JSON.stringify(connection));
    writeFileSync(join(root, 'dist/admin/index.html'), '<div id="app"></div>');
    // The interpreter boundary is external to the launcher. Record real
    // subprocess invocations without starting a database or HTTP server.
    writeFileSync(join(root, '.venv/bin/python'), '#!/bin/sh\nprintf "%s\\n" "$@" >> "' + join(root, 'calls') + '"\nexit 0\n', { mode: 0o755 });
    const result = spawnSync(process.execPath, [join(root, 'scripts/admin-local.mjs')], {
      encoding: 'utf8', env: { PATH: process.env.PATH, ...connection },
    });
    expect(result.status, result.stderr).toBe(0);
    const calls = readFileSync(join(root, 'calls'), 'utf8');
    expect(calls).toContain('waitress');
    expect(calls).not.toContain('migrate');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
