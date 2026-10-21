"""Install inactive deployment tooling. Does not touch the running application."""
import datetime
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import subprocess
import sys

BASE = Path('/srv/surveey')
SOURCE = Path(__file__).resolve().parent
if os.geteuid() != 0 or not (BASE / 'HYBRID_CONFIGURED.json').is_file():
    raise SystemExit('Run as root on the configured Surveey Railway-data VPS only.')
key = sys.stdin.read().strip()
if not re.fullmatch(r'ssh-ed25519 [A-Za-z0-9+/=]+ surveey-github-actions', key):
    raise SystemExit('A dedicated Surveey deployment public key is required.')
try:
    account = pwd.getpwnam('surveey-deploy')
except KeyError:
    subprocess.run(['useradd', '--system', '--create-home', '--user-group',
                    '--home-dir', '/var/lib/surveey-deploy', '--shell', '/bin/sh',
                    'surveey-deploy'], check=True)
    account = pwd.getpwnam('surveey-deploy')
    # An unknown random password hash permits public-key SSH for this system
    # account; the dedicated Match block below disables password authentication.
    import crypt
    import secrets
    subprocess.run(['usermod', '--password', crypt.crypt(secrets.token_urlsafe(64), crypt.mksalt(crypt.METHOD_SHA512)),
                    'surveey-deploy'], check=True)

libexec = Path('/usr/local/libexec')
libexec.mkdir(exist_ok=True)
for source, target in (('ssh-release-gate.py', 'surveey-release-gate.py'),
                        ('receive-release.py', 'surveey-release.py')):
    path = libexec / target
    shutil.copyfile(SOURCE / source, path)
    os.chown(path, 0, 0)
    path.chmod(0o755)

ssh = Path(account.pw_dir) / '.ssh'
ssh.mkdir(mode=0o700, exist_ok=True)
os.chown(ssh, 0, 0)
ssh.chmod(0o755)
authorized = ssh / 'authorized_keys'
line = 'restrict,command="/usr/bin/python3 -I /usr/local/libexec/surveey-release-gate.py" ' + key + '\n'
if authorized.exists() and authorized.read_text() != line:
    raise SystemExit('Existing Surveey deployment key differs; refusing to replace it.')
authorized.write_text(line)
os.chown(authorized, 0, 0)
authorized.chmod(0o644)
sudoers = Path('/etc/sudoers.d/surveey-release')
sudoers.write_text('surveey-deploy ALL=(root) NOPASSWD: /usr/bin/python3 -I /usr/local/libexec/surveey-release.py receive *\n')
sudoers.chmod(0o440)
# Match has its own include. Explicit Match all prevents scope leaking to other
# accounts through subsequent configuration includes; no shared options changed.
restriction = Path('/etc/ssh/sshd_config.d/45-surveey-deploy.conf')
restriction.write_text('Match User surveey-deploy\n'
    '    PasswordAuthentication no\n    KbdInteractiveAuthentication no\n'
    '    AuthenticationMethods publickey\n    AllowTcpForwarding no\n'
    '    X11Forwarding no\n    PermitTTY no\n'
    '    ForceCommand /usr/bin/python3 -I /usr/local/libexec/surveey-release-gate.py\n'
    'Match all\n')
restriction.chmod(0o644)
# Reload only SSH to make this account-specific restriction effective. Existing
# SSH sessions and the unrelated Niskala application/service are not restarted.
subprocess.run(['systemctl', 'reload', 'ssh.service'], check=True)
(BASE / 'releases').mkdir(mode=0o755, exist_ok=True)
(BASE / 'AUTODEPLOY_PREPARED.json').write_text(json.dumps({
    'prepared_at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'repository': 'bbreezyX/surveey', 'branch': 'master', 'ssh_user': 'surveey-deploy',
    'app_restarted': False, 'layout_conversion': 'Deferred until an actual push deploy',
    'tests_or_verification': 'Not performed'}, indent=2) + '\n')
print('Surveey deployment receiver and restricted account installed. No application restarted; no deployment or test run.')
