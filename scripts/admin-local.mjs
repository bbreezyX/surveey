import { spawnSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
mkdirSync(resolve(root, '.local'), { recursive: true });
const secretPath = resolve(root, '.local/django-secret');
if (!existsSync(secretPath)) writeFileSync(secretPath, randomBytes(48).toString('hex'), { mode: 0o600, flag: 'wx' });
const python = resolve(root, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
if (!existsSync(python)) throw new Error('Create .venv and install server/requirements.txt first.');
const env = { ...process.env, SURVEY_ENV: 'local', DJANGO_SECRET_KEY: readFileSync(secretPath, 'utf8') };
// Reuse the same private local secret for operator commands, migration, import and local serving.
const args = process.argv.slice(2);
if (args.length) {
  const command = spawnSync(python, ['server/manage.py', ...args], { cwd: root, env, stdio: 'inherit' });
  process.exit(command.status ?? 1);
}
if (!existsSync(resolve(root, 'dist/admin/index.html'))) throw new Error('Run npm run build:admin first.');
const migrate = spawnSync(python, ['server/manage.py', 'migrate', '--noinput'], { cwd: root, env, stdio: 'inherit' });
if (migrate.status !== 0) process.exit(migrate.status ?? 1);
const server = spawn(python, ['-m', 'waitress', '--listen=127.0.0.1:8130', '--threads=2', '--max-request-body-size=22020096', 'config.admin_wsgi:application'], { cwd: resolve(root, 'server'), env, stdio: 'inherit' });
server.on('exit', code => process.exit(code ?? 1));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
