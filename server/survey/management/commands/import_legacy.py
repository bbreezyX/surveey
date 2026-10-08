import datetime
import hashlib
import json
import re
import uuid
from pathlib import Path
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from delivery import storage
from survey.models import Point, Photo, Observation, ObservationEvidence, Revision
from survey.media import decode
from survey.domain import validate_state, Problem, counts
from survey.services import audit

class Command(BaseCommand):
    help = 'Inventory all legacy records/images. Default is dry run; --apply imports into an empty database only.'
    def add_arguments(self, parser):
        parser.add_argument('--geojson', required=True)
        parser.add_argument('--images', required=True)
        parser.add_argument('--report', required=True)
        parser.add_argument('--apply', action='store_true')
    def handle(self, **options):
        source = Path(options['geojson']).resolve()
        image_root = Path(options['images']).resolve()
        raw_source = source.read_bytes()
        document = json.loads(raw_source)
        if document.get('type') != 'FeatureCollection' or not isinstance(document.get('features'), list):
            raise CommandError('Expected a GeoJSON FeatureCollection.')
        report = {'source_sha256': hashlib.sha256(raw_source).hexdigest(), 'records': [], 'errors': [], 'warnings': [],
            'images': [], 'unreferenced_images': [], 'applied': False}
        paths = {p.name: p for p in image_root.iterdir() if p.is_file()}
        seen, referenced, prepared = set(), set(), []
        for feature in document['features']:
            props = feature.get('properties', {})
            nomor = props.get('Nomor', '')
            row = {'nomor': nomor, 'issues': []}
            report['records'].append(row)
            try:
                if nomor in seen:
                    raise Problem('Duplicate Nomor.')
                seen.add(nomor)
                lon, lat = feature['geometry']['coordinates'][:2]
                if feature['geometry']['type'] != 'Point':
                    raise Problem('Not a Point geometry.')
                for key, actual in [('Longitude', lon), ('Latitude', lat)]:
                    if props.get(key) not in (None, '') and (type(props[key]) not in (float, int) or abs(props[key]-actual) > 1e-9):
                        raise Problem(f'{key} disagrees with geometry; explicit reconciliation required.')
                stamp = str(props.get('Tanggal Dokumentasi') or '').strip()
                iso = ''
                if stamp:
                    try:
                        iso = datetime.datetime.strptime(stamp, '%d/%m/%Y').date().isoformat()
                    except ValueError:
                        row['issues'].append('Invalid date retained as original evidence; current date unknown.')
                state = {k: str(props.get(p) or '') for k,p in {'nomor': 'Nomor', 'nama': 'Nama Anggota',
                    'jalur': 'Jalur', 'alamat': 'Alamat', 'keterangan': 'Keterangan', 'lokasi_rekapan': 'Lokasi Rekapan', 'catatan': 'Catatan'}.items()}
                state.update(status=str(props.get('Status') or ''), duplikat=str(props.get('Duplikat') or '').lower().strip() in ('true', 'ya', '1'),
                    lon=lon, lat=lat, date=iso, photo_id=None, observation_id=None, archived=False)
                state = validate_state(state)
                legacy_name = re.sub(r'[\\/:]', '_', str(props.get('Foto Survey Awal') or '').strip())
                row['legacy_photo'] = legacy_name
                if legacy_name:
                    referenced.add(legacy_name)
                    if legacy_name not in paths:
                        row['issues'].append('Missing photo: no replacement evidence fabricated.')
                prepared.append((state, props, legacy_name))
            except (Problem, KeyError, TypeError, ValueError) as error:
                report['errors'].append({'nomor': nomor, 'error': str(error.message if isinstance(error, Problem) else error)})
        valid_images = set()
        for name, path in sorted(paths.items()):
            raw = path.read_bytes()
            entry = {'name': name, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(), 'ready': False}
            try:
                derivative, width, height = decode(raw, name)
                entry.update(ready=True, width=width, height=height)
                valid_images.add(name)
            except Problem as error:
                entry['issue'] = error.message
                report['warnings'].append({'image': name, 'issue': error.message, 'action': 'Preserve original privately; no public derivative.'})
            report['images'].append(entry)
        report['unreferenced_images'] = sorted(set(paths)-referenced)
        report['counts'] = counts([s for s, _, _ in prepared])
        for row in report['records']:
            if row['issues']:
                report['warnings'].append({'nomor': row['nomor'], 'issues': row['issues']})
        report_path = Path(options['report']).resolve()
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
        if report['errors']:
            raise CommandError(f'Import blocked by {len(report["errors"])} reconciliation errors. See report.')
        if not options['apply']:
            self.stdout.write(f'Dry run: {len(prepared)} records, {len(paths)} images. No database/storage changes.')
            return
        if Point.objects.exists() or Photo.objects.exists():
            raise CommandError('Import requires an empty survey database; reruns cannot overwrite edits.')
        # Object copies precede DB attachment. A failed transaction leaves objects for operator reconciliation,
        # never a partially active map; the source inventory remains untouched.
        stored = {}
        try:
            with transaction.atomic():
                for entry in report['images']:
                    name = entry['name']
                    raw = paths[name].read_bytes()
                    photo_id = uuid.uuid4()
                    original_key = f'originals/{photo_id.hex}'
                    storage.put(original_key, raw)
                    stored[original_key] = True
                    derivative_key, checksum = None, ''
                    if entry['ready']:
                        derivative, width, height = decode(raw, name)
                        derivative_key = f'display/{photo_id.hex}'
                        storage.put(derivative_key, derivative, 'image/jpeg')
                        stored[derivative_key] = True
                        checksum = hashlib.sha256(derivative).hexdigest()
                    photo = Photo.objects.create(id=photo_id, original_key=original_key, derivative_key=derivative_key,
                        original_checksum=entry['sha256'], derivative_checksum=checksum, mime='image/jpeg' if entry['ready'] else '',
                        width=entry.get('width', 0), height=entry.get('height', 0), ready=entry['ready'], legacy_name=name)
                    entry['id'] = str(photo.id)
                by_name = {entry['name']: entry for entry in report['images']}
                for state, props, name in prepared:
                    point = Point.objects.create(nomor=state['nomor'], state=state)
                    obs = Observation.objects.create(point=point, date=state['date'], longitude=state['lon'], latitude=state['lat'],
                        notes=state['catatan'], source=json.dumps({'kind': 'legacy_baseline', 'source_sha256': report['source_sha256'], 'properties': props}, ensure_ascii=False))
                    state['observation_id'] = str(obs.id)
                    if name in by_name:
                        photo = Photo.objects.get(pk=by_name[name]['id'])
                        if photo.point_id is not None and photo.point_id != point.id:
                            raise CommandError('One legacy image is referenced by multiple points; reconcile explicitly.')
                        photo.point = point
                        photo.save(update_fields=['point'])
                        ObservationEvidence.objects.create(observation=obs, photo=photo)
                        if photo.ready:
                            state['photo_id'] = str(photo.id)
                    point.state = state
                    point.save(update_fields=['state'])
                    Revision.objects.create(point=point, number=1, state=state, reason='Impor baseline; bukti sumber dipertahankan.')
                audit(None, 'legacy.imported', report['source_sha256'], after={'records': len(prepared), 'images': len(paths), 'counts': report['counts']})
        except Exception:
            for key in stored:
                storage.remove(key)
            raise
        report['applied'] = True
        report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
        self.stdout.write(f'Imported {len(prepared)} records and {len(paths)} original evidence files. Nothing published yet.')
