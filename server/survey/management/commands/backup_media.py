import hashlib
import json
import tarfile
from pathlib import Path
from django.core.management.base import BaseCommand, CommandError
from survey.models import Photo
from delivery import storage

class Command(BaseCommand):
    help = 'Back up every original and derivative referenced in the database with checksum verification.'
    def add_arguments(self, parser):
        parser.add_argument('--output', required=True)
    def handle(self, **options):
        output = Path(options['output']).resolve()
        if output.exists():
            raise CommandError('Output must be a new directory.')
        output.mkdir(parents=True)
        manifest = []
        for photo in Photo.objects.order_by('pk'):
            for key, checksum in [(photo.original_key, photo.original_checksum), (photo.derivative_key, photo.derivative_checksum)]:
                if not key:
                    continue
                with storage.get(key) as stream:
                    raw = stream.read()
                actual = hashlib.sha256(raw).hexdigest()
                if actual != checksum:
                    raise CommandError(f'Checksum mismatch for {key}; backup incomplete.')
                path = output / key
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(raw)
                manifest.append({'key': key, 'checksum': actual, 'bytes': len(raw)})
        (output/'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
        self.stdout.write(f'Backed up {len(manifest)} immutable objects. Pair with a consistent pg_dump while writes are paused.')
