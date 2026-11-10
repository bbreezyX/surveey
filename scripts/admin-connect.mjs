// Provision this machine's private connection, without changing database networking or data.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const local = resolve(root, '.local');
// Production moved to the VPS on 22 October 2026; this is its Tailscale OpenSSH login.
const vps = process.env.SURVEY_VPS_SSH || 'ubuntu@100.64.182.105';

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  // The environment file contains secrets, so subprocess output is never echoed.
  if (result.status !== 0) throw new Error(`${command} ${args[0]} failed; check VPS SSH access over Tailscale. Output withheld.`);
  return result.stdout;
}

try {
  mkdirSync(local, { recursive: true, mode: 0o700 });
  const raw = run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'StrictHostKeyChecking=yes', vps,
    'sudo', '-n', 'cat', '/srv/surveey/private/admin.env']);
  const variables = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (match) variables[match[1]] = match[2].replace(/^"(.*)"$/, '$1');
  }
  if (!variables.DATABASE_URL) throw new Error('Production DATABASE_URL is unavailable.');
  const database = new URL(variables.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || database.username !== 'survey_admin_app') {
    throw new Error('Expected the restricted production admin PostgreSQL login.');
  }
  if (database.hostname !== '127.0.0.1' || !database.port) throw new Error('Expected the VPS loopback PostgreSQL endpoint.');
  // admin:local forwards this local port to the VPS loopback port over SSH.
  const remotePort = database.port;
  database.port = '15432';
  const config = { DATABASE_URL: database.toString(), DB_SSLMODE: variables.DB_SSLMODE || 'require',
    VPS_SSH_HOST: vps, VPS_DB_PORT: remotePort };
  const path = resolve(local, 'admin-production.json');
  // Restrict an empty/new file before writing credentials; POSIX mode does
  // not enforce private access on Windows, where an explicit ACL is needed.
  if (!existsSync(path)) writeFileSync(path, '', { mode: 0o600, flag: 'wx' });
  if (process.platform === 'win32') {
    const owner = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}` : process.env.USERNAME;
    if (!owner) throw new Error('Cannot resolve the local Windows account for private credential access.');
    run('icacls', [path, '/inheritance:r', '/grant:r', `${owner}:(F)`]);
  } else chmodSync(path, 0o600);
  // Replacing the whole file drops the retired Railway bucket and SSH settings.
  writeFileSync(path, JSON.stringify(config));
  console.log('Production connection saved privately. Run npm run build:admin, then npm run admin:local.');
} catch (error) { console.error(error.message); process.exit(1); }
