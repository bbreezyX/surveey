// Provision this machine's private connection, without changing database networking or data.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, chmodSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

const root = resolve(import.meta.dirname, '..');
const local = resolve(root, '.local');
const project = 'ebebdd21-0358-4ab1-a0d5-1afe4ee2673b';
const environment = '6abf965b-42d4-44ad-8b15-55c8be2adc76';
const admin = '55d8e517-529a-4985-bc66-0bad6f5e16d4';
const postgres = 'ca38ef07-1f75-4191-a905-af3a9af4a423';
const env = { ...process.env, RAILWAY_CALLER: 'skill:use-railway@1.5.2', RAILWAY_AGENT_SESSION: 'surveypjuts-local-production-setup' };

function run(command, args, allowRegisteredKey = false) {
  const npmCli = process.platform === 'win32' && process.env.APPDATA ? resolve(process.env.APPDATA, 'npm/node_modules/@railway/cli/bin/railway.js') : '';
  const useNpmCli = command === 'railway' && npmCli && existsSync(npmCli);
  const result = spawnSync(useNpmCli ? process.execPath : command, useNpmCli ? [npmCli, ...args] : args, { cwd: root, env, encoding: 'utf8' });
  // Railway variable output contains secrets, so subprocess output is never echoed.
  if (result.status !== 0 && !(allowRegisteredKey && /already registered|already exists/i.test((result.stderr ?? '') + (result.stdout ?? '')))) {
    throw new Error(`${command} ${args[0]} failed; check CLI authentication and access. Output withheld.`);
  }
  return result.stdout;
}

try {
  mkdirSync(local, { recursive: true, mode: 0o700 });
  let variables;
  const raw = run('railway', ['variable', 'list', '--json', '--project', project, '--environment', environment, '--service', admin]);
  try { variables = JSON.parse(raw); }
  catch { throw new Error('Production variable response is invalid; credentials withheld.'); }
  const required = ['DATABASE_URL', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'];
  for (const name of required) if (!variables[name]) throw new Error(`Production ${name} is unavailable.`);
  const database = new URL(variables.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || database.username !== 'survey_admin_app') {
    throw new Error('Expected the restricted production admin PostgreSQL login.');
  }
  // This CLI discovers keys in ~/.ssh; keeping it outside the checkout also
  // prevents a copied project directory from carrying the private key with it.
  const sshDirectory = resolve(homedir(), '.ssh');
  mkdirSync(sshDirectory, { recursive: true, mode: 0o700 });
  const identity = resolve(sshDirectory, 'surveypjuts-production_ed25519');
  if (!existsSync(identity)) {
    run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'surveypjuts local production', '-f', identity]);
  }
  // Reconcile registration on every setup so a replaced or revoked key cannot
  // be hidden by a stale local marker. The CLI may report an existing key.
  run('railway', ['ssh', 'keys', 'add', '--key', identity + '.pub', '--name', 'surveypjuts-local-production'], true);
  const marker = resolve(local, 'railway-key-registered');
  if (existsSync(marker)) unlinkSync(marker);
  const sshConfig = resolve(local, 'railway-ssh-config');
  run('railway', ['ssh', 'config', '--project', project, '--environment', environment, '--service', postgres,
    '--path', sshConfig, '--alias', 'survey-production-db', '--identity-file', identity]);
  database.hostname = '127.0.0.1';
  database.port = '15432';
  const config = Object.fromEntries([...required.filter(name => name !== 'DATABASE_URL'), 'S3_REGION', 'S3_ADDRESSING_STYLE']
    .filter(name => variables[name]).map(name => [name, variables[name]]));
  Object.assign(config, { DATABASE_URL: database.toString(), DB_SSLMODE: 'require', SSH_CONFIG: sshConfig, SSH_IDENTITY: identity,
    SSH_PROJECT: project, SSH_ENVIRONMENT: environment, SSH_SERVICE: postgres });
  const path = resolve(local, 'admin-production.json');
  // Restrict an empty/new file before writing credentials; POSIX mode does
  // not enforce private access on Windows, where an explicit ACL is needed.
  if (!existsSync(path)) writeFileSync(path, '', { mode: 0o600, flag: 'wx' });
  if (process.platform === 'win32') {
    const owner = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}` : process.env.USERNAME;
    if (!owner) throw new Error('Cannot resolve the local Windows account for private credential access.');
    run('icacls', [path, '/inheritance:r', '/grant:r', `${owner}:(F)`]);
  } else { chmodSync(path, 0o600); chmodSync(sshConfig, 0o600); }
  writeFileSync(path, JSON.stringify(config));
  console.log('Production connection saved privately. Run npm run build:admin, then npm run admin:local.');
} catch (error) { console.error(error.message); process.exit(1); }
