#!/usr/bin/python3
"""Forced SSH command: accept one bounded receive operation, never a shell."""
import os
import re

command = os.environ.get('SSH_ORIGINAL_COMMAND', '')
match = re.fullmatch(r'receive ([a-f0-9]{40}) ([0-9]{1,20}-[0-9]{1,5}) ([a-f0-9]{64})', command)
if not match:
    raise SystemExit('Only a Surveey release upload is permitted.')
os.execv('/usr/bin/sudo', ['sudo', '-n', '/usr/bin/python3', '-I',
         '/usr/local/libexec/surveey-release.py', 'receive', *match.groups()])
