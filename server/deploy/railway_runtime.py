import os
import signal
import subprocess
import sys
import time

if not os.environ.get('RAILWAY_ENVIRONMENT_ID') or os.environ.get('SURVEY_ENV') == 'local':
    raise SystemExit('Railway runtime requires a Railway production/staging environment.')
port = int(os.environ.get('PORT', '8080'))
if not 1 <= port <= 65535:
    raise SystemExit('Invalid PORT.')
application = sys.argv[1]
children = []
if application == 'config.admin_wsgi:application':
    if port in (9000, 9001):
        raise SystemExit('PORT must differ from the internal ports 9000 and 9001.')
    children.append(subprocess.Popen(['gunicorn', application, '--config', 'gunicorn.railway.py']))
    children.append(subprocess.Popen(['gunicorn', 'config.media_wsgi:application', '--bind', '[::]:9001',
        '--workers', '2', '--timeout', '60', '--forwarded-allow-ips=', '--no-control-socket', '--error-logfile', '-']))
    children.append(subprocess.Popen(['caddy', 'run', '--config', 'Caddyfile.railway-admin', '--adapter', 'caddyfile']))
elif application == 'config.public_wsgi:application':
    # Bind IPv6 for Railway private DNS; never attach a public domain to this service.
    children.append(subprocess.Popen(['gunicorn', application, '--bind', f'[::]:{port}', '--workers', '2',
        '--threads', '1', '--timeout', '60', '--forwarded-allow-ips=', '--no-control-socket', '--access-logfile', '-', '--error-logfile', '-']))
else:
    raise SystemExit('Unknown service application.')

def stop(signum=None, frame=None):
    for child in children:
        if child.poll() is None:
            child.terminate()

signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
try:
    while all(child.poll() is None for child in children):
        time.sleep(0.25)
    status = next((child.returncode for child in children if child.returncode is not None), 1)
finally:
    stop()
    for child in children:
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            child.kill()
sys.exit(0 if status in (0, -signal.SIGTERM) else 1)
