import { spawnSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { createConnection } from 'node:net';
const root = resolve(import.meta.dirname, '..');
mkdirSync(resolve(root, '.local'), { recursive: true });
const secretPath = resolve(root, '.local/django-secret');
if (!existsSync(secretPath)) writeFileSync(secretPath, randomBytes(48).toString('hex'), { mode: 0o600, flag: 'wx' });
const python = resolve(root, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
if (!existsSync(python)) throw new Error('Create .venv and install server/requirements.txt first.');
const args = process.argv.slice(2);
// Tests never load production credentials or open the Railway tunnel.
const test = args[0] === 'test';
const configPath = resolve(root, '.local/admin-production.json');
let config = {};
if (!test && existsSync(configPath)) {
  try { config = JSON.parse(readFileSync(configPath, 'utf8')); }
  catch { console.error('Private production connection configuration is invalid. Run npm run admin:connect again.'); process.exit(1); }
}
const env = { ...config, ...process.env, SURVEY_ENV: 'local', DJANGO_SECRET_KEY: readFileSync(secretPath, 'utf8'),
  DJANGO_SETTINGS_MODULE: test ? 'config.test_settings' : 'config.admin_settings' };
delete env.SURVEY_DEPLOYMENT;
delete env.RAILWAY_ENVIRONMENT_ID;
if (test) {
  delete env.DATABASE_URL;
  const command = spawnSync(python, ['server/manage.py', ...args], { cwd: root, env, stdio: 'inherit' });
  process.exit(command.status ?? 1);
}
if (!env.DATABASE_URL) throw new Error('Run npm run admin:connect to configure the production PostgreSQL connection.');
let database;
try { database = new URL(env.DATABASE_URL); } catch { throw new Error('DATABASE_URL must be a valid PostgreSQL connection.'); }
if (!['postgres:', 'postgresql:'].includes(database.protocol)) throw new Error('DATABASE_URL must use PostgreSQL; local SQLite is unavailable.');
if (['migrate', 'makemigrations', 'flush', 'loaddata', 'import_legacy', 'provision_account', 'restore_media'].includes(args[0])) {
  throw new Error('Use the production operator workflow for database initialization, migration or restoration.');
}
if (!args.length && !existsSync(resolve(root, 'dist/admin/index.html'))) throw new Error('Run npm run build:admin first.');

const children = new Set();
const stop = () => { for (const child of children) child.kill('SIGTERM'); };
process.on('exit', stop);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stop(); process.exit(0); });

function portReady(port) {
  return new Promise(resolveReady => {
    const socket = createConnection({ host: '127.0.0.1', port });
    let done = false;
    const finish = value => { if (!done) { done = true; socket.destroy(); resolveReady(value); } };
    socket.setTimeout(250, () => finish(false));
    socket.on('connect', () => finish(true));
    socket.on('error', () => finish(false));
  });
}

async function main() {
  if (config.SSH_CONFIG && env.DATABASE_URL === config.DATABASE_URL) {
    const railwayEnv = { ...process.env, RAILWAY_CALLER: 'skill:use-railway@1.5.2', RAILWAY_AGENT_SESSION: 'surveypjuts-local-production' };
    // Refresh the SSH destination when Railway has replaced the database container.
    const npmCli = process.platform === 'win32' && process.env.APPDATA ? resolve(process.env.APPDATA, 'npm/node_modules/@railway/cli/bin/railway.js') : '';
    const useNpmCli = npmCli && existsSync(npmCli);
    const refresh = spawnSync(useNpmCli ? process.execPath : 'railway', [...(useNpmCli ? [npmCli] : []), 'ssh', 'config', '--project', config.SSH_PROJECT, '--environment', config.SSH_ENVIRONMENT,
      '--service', config.SSH_SERVICE, '--path', config.SSH_CONFIG, '--alias', 'survey-production-db', '--identity-file', config.SSH_IDENTITY],
      { cwd: root, env: railwayEnv, encoding: 'utf8' });
    if (refresh.status !== 0) throw new Error('Could not resolve the production database SSH destination; check Railway login.');
    const port = Number(database.port);
    if (await portReady(port)) throw new Error('The database tunnel port is already occupied. Stop the previous local admin before starting another.');
    const tunnel = spawn('ssh', ['-F', config.SSH_CONFIG, '-i', config.SSH_IDENTITY, '-N', '-L', `127.0.0.1:${port}:127.0.0.1:5432`,
      '-o', 'ExitOnForwardFailure=yes', '-o', 'BatchMode=yes', '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3',
      '-o', 'StrictHostKeyChecking=accept-new', '-o', `UserKnownHostsFile=${resolve(root, '.local/railway-known-hosts')}`, 'survey-production-db'],
      { stdio: ['ignore', 'ignore', 'pipe'] });
    children.add(tunnel);
    let failure = '';
    tunnel.stderr.on('data', chunk => { failure = (failure + chunk).slice(-1000); });
    tunnel.on('error', () => { failure = 'Could not start the system SSH client.'; });
    const deadline = Date.now() + 20000;
    while (tunnel.exitCode === null && Date.now() < deadline) {
      if (await portReady(port)) break;
      await new Promise(resolveWait => setTimeout(resolveWait, 200));
    }
    if (tunnel.exitCode !== null || !await portReady(port)) throw new Error('Production database tunnel failed. ' + failure.trim());
    tunnel.on('exit', () => { console.error('Production database tunnel closed.'); stop(); process.exit(1); });
  }
  if (args.length) {
    const command = spawnSync(python, ['server/manage.py', ...args], { cwd: root, env, stdio: 'inherit' });
    process.exit(command.status ?? 1);
  }
  // Only inspect the live connection. Startup must never migrate or seed this shared database.
  const check = spawnSync(python, ['-c', "import django; django.setup(); from django.db import connection; c=connection.cursor(); c.execute('SHOW server_version'); print('Connected to production PostgreSQL ' + c.fetchone()[0]); c.close(); connection.close()"],
    { cwd: resolve(root, 'server'), env, stdio: 'inherit' });
  if (check.status !== 0) process.exit(check.status ?? 1);
  const server = spawn(python, ['-m', 'waitress', '--listen=127.0.0.1:8130', '--threads=2', '--max-request-body-size=22020096', 'config.admin_wsgi:application'],
    { cwd: resolve(root, 'server'), env, stdio: 'inherit' });
  children.add(server);
  server.on('error', () => { console.error('Could not start the local admin server.'); process.exit(1); });
  server.on('exit', code => process.exit(code ?? 1));
}
main().catch(error => { console.error(error.message); process.exit(1); });
