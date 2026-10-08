import hashlib
import json
from pathlib import Path
from django.core.management.base import BaseCommand, CommandError
from delivery import storage

class Command(BaseCommand):
    help = 'Verify backup checksums, then restore to empty storage with --apply. Use only for an approved restore rehearsal.'
    def add_arguments(self, parser):
        parser.add_argument('--input', required=True)
        parser.add_argument('--apply', action='store_true')
    def handle(self, **options):
        root = Path(options['input']).resolve()
        manifest = json.loads((root/'manifest.json').read_text(encoding='utf-8'))
        if not isinstance(manifest, list):
            raise CommandError('Invalid backup manifest.')
        # Validate every entry before any mutation. Only fixed opaque key shapes are accepted.
        seen = set()
        for item in manifest:
            key = item['key']
            storage.check_key(key)
            if key in seen:
                raise CommandError('Repeated object key.')
            seen.add(key)
            path = (root/key).resolve()
            if not path.is_relative_to(root):
                raise CommandError('Unsafe backup path.')
            raw = path.read_bytes()
            if len(raw) != item['bytes'] or hashlib.sha256(raw).hexdigest() != item['checksum']:
                raise CommandError(f'Invalid checksum for {key}.')
            if options['apply'] and storage.exists(key):
                raise CommandError('Restore destination is not empty; no existing evidence is overwritten.')
        if options['apply']:
            for item in manifest:
                storage.put(item['key'], (root/item['key']).read_bytes(), 'image/jpeg' if item['key'].startswith('display/') else 'application/octet-stream')
        self.stdout.write(f'{len(manifest)} objects verified. ' + ('Restored.' if options['apply'] else 'Dry run; nothing changed.'))
