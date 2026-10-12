from django.test import TestCase, SimpleTestCase, Client, override_settings
from .models import Account


class LocalProductionConfigurationTests(SimpleTestCase):
    def configure(self, values):
        import os
        import subprocess
        import sys
        from pathlib import Path
        return subprocess.run([sys.executable, '-c',
            "import json,config.base as c; print(json.dumps({'database':c.DATABASES['default']['ENGINE'],'storage':c.STORAGE_BACKEND}))"],
            cwd=Path(__file__).resolve().parents[1], capture_output=True, text=True,
            env={'PATH': os.environ.get('PATH', ''), 'SURVEY_ENV': 'local',
                 'DJANGO_SECRET_KEY': 'configuration-test-only-' * 4, **values})

    def test_missing_postgres_connection_cannot_create_a_local_sqlite_database(self):
        result = self.configure({})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('DATABASE_URL', result.stderr)

    def test_local_postgres_uses_the_production_photo_storage(self):
        import json
        result = self.configure({'DATABASE_URL': 'postgresql://survey_admin_app:fixture@127.0.0.1:15432/railway',
            'S3_ENDPOINT': 'https://storage.example.invalid', 'S3_BUCKET': 'fixture',
            'S3_ACCESS_KEY': 'fixture', 'S3_SECRET_KEY': 'fixture'})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {'database': 'django.db.backends.postgresql', 'storage': 's3'})


class AdminPathTests(TestCase):
    def setUp(self):
        self.user = Account.objects.create_user(username='routing-owner', password='test-only-password-347192', role='owner')
        self.client = Client(enforce_csrf_checks=True)

    def test_login_page_and_root_redirect_use_admin_path(self):
        self.assertRedirects(self.client.get('/'), '/admin/', fetch_redirect_response=False)
        self.assertRedirects(self.client.get('/admin'), '/admin/', fetch_redirect_response=False)
        page = self.client.get('/admin/')
        self.assertEqual(page.status_code, 200)
        self.assertContains(page, 'action="/admin/login"')
        self.assertNotContains(page, 'href="/assets/')
        self.assertNotContains(page, 'src="/assets/')
        self.assertEqual(page.cookies['survey_admin_csrf']['path'], '/admin/')

    def test_anonymous_api_and_admin_app_assets_are_protected(self):
        for path in ('/admin/api/session', '/admin/api/points', '/admin/api/wilayah', '/admin/assets/unknown.js'):
            result = self.client.get(path)
            self.assertEqual(result.status_code, 401)
            self.assertEqual(result['Cache-Control'], 'private, no-store')
        self.assertEqual(self.client.get('/api/session').status_code, 404)

    def test_login_logout_csrf_and_cookie_scope(self):
        self.assertEqual(self.client.post('/admin/login', {'username': self.user.username, 'password': 'test-only-password-347192'}).status_code, 403)
        self.client.get('/admin/')
        token = self.client.cookies['survey_admin_csrf'].value
        login = self.client.post('/admin/login', {'username': self.user.username, 'password': 'test-only-password-347192', 'csrfmiddlewaretoken': token})
        self.assertRedirects(login, '/admin/', fetch_redirect_response=False)
        cookie = login.cookies['survey_admin_session']
        self.assertEqual(cookie['path'], '/admin/')
        self.assertTrue(cookie['httponly'])
        self.assertEqual(cookie['samesite'], 'Strict')
        session = self.client.get('/admin/api/session')
        self.assertEqual(session.status_code, 200)
        self.assertEqual(session.json()['account']['username'], self.user.username)
        self.assertEqual(self.client.post('/admin/logout').status_code, 403)
        logout = self.client.post('/admin/logout', HTTP_X_CSRFTOKEN=session.json()['csrf'])
        self.assertRedirects(logout, '/admin/', fetch_redirect_response=False)
        self.assertEqual(self.client.get('/admin/api/session').status_code, 401)

    @override_settings(SESSION_COOKIE_SECURE=True, CSRF_COOKIE_SECURE=True)
    def test_production_cookies_remain_secure(self):
        self.client.get('/admin/', secure=True)
        token = self.client.cookies['survey_admin_csrf'].value
        self.assertTrue(self.client.cookies['survey_admin_csrf']['secure'])
        login = self.client.post('/admin/login', {'username': self.user.username, 'password': 'test-only-password-347192', 'csrfmiddlewaretoken': token}, secure=True, HTTP_ORIGIN='https://testserver')
        self.assertEqual(login.status_code, 302)
        self.assertTrue(login.cookies['survey_admin_session']['secure'])

    def test_wilayah_tree_lists_jambi_regions_for_the_address_picker(self):
        self.client.get('/admin/')
        token = self.client.cookies['survey_admin_csrf'].value
        self.client.post('/admin/login', {'username': self.user.username, 'password': 'test-only-password-347192', 'csrfmiddlewaretoken': token})
        tree = self.client.get('/admin/api/wilayah').json()
        self.assertEqual(len(tree), 11)
        kota = next(kab for kab in tree if kab['nama'] == 'Kota Jambi')
        mestong = next(kec for kab in tree if kab['nama'] == 'Kabupaten Muaro Jambi' for kec in kab['kecamatan'] if kec['nama'] == 'Mestong')
        self.assertIn('Kel. Tempino', mestong['desa'])
        self.assertTrue(all(desa.startswith(('Desa ', 'Kel. ')) for kec in kota['kecamatan'] for desa in kec['desa']))

    def test_alamat_fix_batch_drafts_once_and_dry_run_writes_nothing(self):
        from django.core.management import call_command
        from .models import Draft
        from .services import create_point
        state = {'nomor': 'MUARO JAMBI-MESTONG-TEMPINO-001', 'nama': '', 'jalur': '', 'alamat': 'Desa Tempino, Kecamatan Mestong, Kabupaten Muaro Jambi',
            'keterangan': '', 'lokasi_rekapan': '', 'catatan': '', 'status': '', 'duplikat': False, 'archived': False,
            'lon': 103.5, 'lat': -1.78, 'date': '', 'photo_id': None, 'observation_id': None}
        point = create_point(self.user, state, 'Uji')
        call_command('draft_alamat_fixes', stdout=__import__('io').StringIO())
        self.assertFalse(Draft.objects.exists())
        for _ in range(2):
            call_command('draft_alamat_fixes', '--apply', '--actor', self.user.username, stdout=__import__('io').StringIO())
        draft = Draft.objects.get()
        self.assertEqual((draft.point_id, draft.status), (point.id, 'pending'))
        self.assertEqual(draft.proposed['state']['alamat'], 'Kel. Tempino, Kecamatan Mestong, Kabupaten Muaro Jambi')

    def test_point_list_and_detail_count_pending_drafts(self):
        from .services import create_point, save_draft
        state = {'nomor': 'KOTA JAMBI-KOTA BARU-PAAL LIMA-001', 'nama': '', 'jalur': '', 'alamat': 'Kel. Paal Lima, Kecamatan Kota Baru, Kota Jambi',
            'keterangan': '', 'lokasi_rekapan': '', 'catatan': '', 'status': '', 'duplikat': False, 'archived': False,
            'lon': 103.6, 'lat': -1.6, 'date': '', 'photo_id': None, 'observation_id': None}
        point = create_point(self.user, state, 'Uji')
        self.client.get('/admin/')
        token = self.client.cookies['survey_admin_csrf'].value
        self.client.post('/admin/login', {'username': self.user.username, 'password': 'test-only-password-347192', 'csrfmiddlewaretoken': token})
        listed = lambda: self.client.get('/admin/api/points?archived=1').json()['items'][0]['drafts']
        detail = lambda: self.client.get(f'/admin/api/points/{point.id}').json()['drafts']
        self.assertEqual((listed(), detail()), (0, 0))
        save_draft(self.user, str(point.id), point.revision, {'state': dict(point.state, catatan='Uji draf'), 'new_observation': None}, 'Uji')
        self.assertEqual((listed(), detail()), (1, 1))

    def test_saving_again_revises_own_pending_draft_and_detail_returns_it(self):
        from .models import Account, AuditEvent, Draft
        from .services import create_point, save_draft
        state = {'nomor': 'KOTA JAMBI-KOTA BARU-PAAL LIMA-002', 'nama': '', 'jalur': '', 'alamat': 'Kel. Paal Lima, Kecamatan Kota Baru, Kota Jambi',
            'keterangan': '', 'lokasi_rekapan': '', 'catatan': '', 'status': '', 'duplikat': False, 'archived': False,
            'lon': 103.6, 'lat': -1.6, 'date': '', 'photo_id': None, 'observation_id': None}
        point = create_point(self.user, state, 'Uji')
        first = save_draft(self.user, str(point.id), point.revision, {'state': dict(point.state, catatan='Satu'), 'new_observation': None}, 'Pertama')
        second = save_draft(self.user, str(point.id), point.revision, {'state': dict(point.state, catatan='Dua'), 'new_observation': None}, 'Kedua')
        self.assertEqual(first.id, second.id)
        draft = Draft.objects.get(status='pending')
        self.assertEqual((draft.proposed['state']['catatan'], draft.reason), ('Dua', 'Kedua'))
        self.assertTrue(AuditEvent.objects.filter(action='draft.updated', target=str(draft.id)).exists())
        other = Account.objects.create_user(username='routing-editor', password='test-only-password-551208', role='editor')
        save_draft(other, str(point.id), point.revision, {'state': dict(point.state, catatan='Lain'), 'new_observation': None}, 'Akun lain')
        self.assertEqual(Draft.objects.filter(status='pending').count(), 2)
        self.client.get('/admin/')
        token = self.client.cookies['survey_admin_csrf'].value
        self.client.post('/admin/login', {'username': self.user.username, 'password': 'test-only-password-347192', 'csrfmiddlewaretoken': token})
        detail = self.client.get(f'/admin/api/points/{point.id}').json()
        self.assertEqual(detail['drafts'], 2)
        self.assertEqual((detail['own_draft']['id'], detail['own_draft']['reason']), (str(draft.id), 'Kedua'))
        self.assertEqual(detail['own_draft']['proposed']['state']['catatan'], 'Dua')

    def test_nomor_follows_the_address_with_the_next_free_number(self):
        from .domain import nomor_prefix, same_place
        from .models import Point
        from .services import create_point, save_draft, publish
        self.assertEqual(nomor_prefix('Desa Pelempang, Kecamatan Mestong, Kabupaten Muaro Jambi'), 'MUARO JAMBI-MESTONG-PELEMPANG')
        self.assertEqual(nomor_prefix('Kel. Kenali Besar, Kecamatan Alam Barajo, Kota Jambi'), 'KOTA JAMBI-ALAM BARAJO-KENALI BESAR')
        self.assertEqual(nomor_prefix('Desa X, Kecamatan Muko-muko Bathin VII, Kabupaten Bungo'), 'BUNGO-MUKO MUKO BATHIN VII-X')
        self.assertIsNone(nomor_prefix('RT 21 Rawasari, Kota Jambi'))
        self.assertTrue(same_place('Muaro Jambi-Mestong-Desa Suka Damai-001', 'MUARO JAMBI-MESTONG-SUKA DAMAI'))
        self.assertFalse(same_place('MUARO BUNGO-SEPENGGAL LINTAS-LUBUK LANDAI-001', 'BUNGO-TANAH SEPENGGAL LINTAS-LUBUK LANDAI'))
        def point(nomor, alamat):
            return create_point(self.user, {'nomor': nomor, 'nama': '', 'jalur': '', 'alamat': alamat, 'keterangan': '', 'lokasi_rekapan': '',
                'catatan': '', 'status': '', 'duplikat': False, 'archived': False, 'lon': 103.5, 'lat': -1.8, 'date': '', 'photo_id': None, 'observation_id': None}, 'Uji')
        pelempang = 'Desa Pelempang, Kecamatan Mestong, Kabupaten Muaro Jambi'
        point('MUARO JAMBI-MESTONG-PELEMPANG-001', pelempang)
        point('MUARO JAMBI-MESTONG-PELEMPANG-003', pelempang)
        first = point('MUARO JAMBI-MESTONG-TEMPINO-001', 'Kel. Tempino, Kecamatan Mestong, Kabupaten Muaro Jambi')
        second = point('MUARO JAMBI-MESTONG-TEMPINO-002', 'Kel. Tempino, Kecamatan Mestong, Kabupaten Muaro Jambi')
        a = save_draft(self.user, str(first.id), first.revision, {'state': dict(first.state, alamat=pelempang), 'new_observation': None}, 'Pindah')
        other = __import__('survey.models', fromlist=['Account']).Account.objects.create_user(username='routing-editor-2', password='test-only-password-551209', role='editor')
        b = save_draft(other, str(second.id), second.revision, {'state': dict(second.state, alamat=pelempang), 'new_observation': None}, 'Pindah')
        self.assertEqual(a.proposed['state']['nomor'], 'MUARO JAMBI-MESTONG-PELEMPANG-004')
        self.assertEqual(b.proposed['state']['nomor'], 'MUARO JAMBI-MESTONG-PELEMPANG-005')
        # Saving again keeps the number it already holds.
        a = save_draft(self.user, str(first.id), first.revision, {'state': a.proposed['state'], 'new_observation': None}, 'Pindah lagi')
        self.assertEqual(a.proposed['state']['nomor'], 'MUARO JAMBI-MESTONG-PELEMPANG-004')
        # The number cannot be typed freely, and spelling alone does not rename.
        c = point('Muaro Jambi-Mestong-Desa Suka Damai-001', 'Desa Suka Damai, Kecamatan Mestong, Kabupaten Muaro Jambi')
        d = save_draft(self.user, str(c.id), c.revision, {'state': dict(c.state, nomor='X-Y-Z-999', catatan='Catat'), 'new_observation': None}, 'Catatan')
        self.assertEqual(d.proposed['state']['nomor'], 'Muaro Jambi-Mestong-Desa Suka Damai-001')
        publish(self.user, [str(a.id), str(b.id)], 'Terbit')
        self.assertEqual(sorted(Point.objects.filter(nomor__contains='PELEMPANG').values_list('nomor', flat=True)),
            ['MUARO JAMBI-MESTONG-PELEMPANG-001', 'MUARO JAMBI-MESTONG-PELEMPANG-003', 'MUARO JAMBI-MESTONG-PELEMPANG-004', 'MUARO JAMBI-MESTONG-PELEMPANG-005'])
        first.refresh_from_db()
        self.assertEqual((first.nomor, first.state['nomor']), ('MUARO JAMBI-MESTONG-PELEMPANG-004', 'MUARO JAMBI-MESTONG-PELEMPANG-004'))

    def test_renumbering_closes_one_desa_gaps_on_request_and_publishes(self):
        from delivery.models import ActivePublication
        from .domain import Problem
        from .models import AuditEvent, Point, Revision
        from .services import create_point, save_draft, discard_draft, renumber
        ActivePublication.objects.get_or_create(id=1)
        def point(nomor, alamat, **extra):
            created = create_point(self.user, {'nomor': nomor, 'nama': '', 'jalur': '', 'alamat': alamat, 'keterangan': '', 'lokasi_rekapan': '',
                'catatan': '', 'status': '', 'duplikat': False, 'archived': False, 'lon': 103.5, 'lat': -1.8, 'date': '', 'photo_id': None, 'observation_id': None}, 'Uji')
            # create_point always starts as an archive; most of these stand in for active points.
            state = {**created.state, 'archived': False, **extra}
            Point.objects.filter(pk=created.pk).update(state=state, archived=state['archived'])
            created.refresh_from_db()
            return created
        pelempang, tempino = 'Desa Pelempang, Kecamatan Mestong, Kabupaten Muaro Jambi', 'Kel. Tempino, Kecamatan Mestong, Kabupaten Muaro Jambi'
        a = point('MUARO JAMBI-MESTONG-PELEMPANG-001', pelempang)
        b = point('MUARO JAMBI-MESTONG-PELEMPANG-003', pelempang, status='Cadangan')
        c = point('MUARO JAMBI-MESTONG-PELEMPANG-004', pelempang, archived=True)
        point('MUARO JAMBI-MESTONG-TEMPINO-001', tempino)
        point('MUARO JAMBI-MESTONG-TEMPINO-003', tempino)
        point('MUARO JAMBI-MESTONG-SUKA DAMAI-001', 'Desa Suka Damai, Kecamatan Mestong, Kabupaten Muaro Jambi')
        self.client.get('/admin/')
        token = self.client.cookies['survey_admin_csrf'].value
        self.client.post('/admin/login', {'username': self.user.username, 'password': 'test-only-password-347192', 'csrfmiddlewaretoken': token})
        self.assertEqual(self.client.get('/admin/api/points').json()['gaps'],
            ['MUARO JAMBI-MESTONG-PELEMPANG', 'MUARO JAMBI-MESTONG-TEMPINO'])
        editor = Account.objects.create_user(username='renumber-editor', password='test-only-password-551210', role='editor')
        with self.assertRaises(Problem):
            renumber(editor, 'MUARO JAMBI-MESTONG-PELEMPANG', 'Rapikan')
        with self.assertRaisesMessage(Problem, 'tidak memiliki nomor yang perlu dirapikan'):
            renumber(self.user, 'MUARO JAMBI-MESTONG-SUKA DAMAI', 'Rapikan')
        # A pending draft on a point in the desa, or one reserving a number
        # there from elsewhere, would be turned into a conflict.
        own = save_draft(self.user, str(a.id), a.revision, {'state': dict(a.state, catatan='Uji'), 'new_observation': None}, 'Uji')
        with self.assertRaisesMessage(Problem, 'Selesaikan draf'):
            renumber(self.user, 'MUARO JAMBI-MESTONG-PELEMPANG', 'Rapikan')
        discard_draft(self.user, str(own.id))
        mover = Point.objects.get(nomor='MUARO JAMBI-MESTONG-TEMPINO-001')
        moving = save_draft(self.user, str(mover.id), mover.revision, {'state': dict(mover.state, alamat=pelempang), 'new_observation': None}, 'Pindah')
        with self.assertRaisesMessage(Problem, 'Selesaikan draf'):
            renumber(self.user, 'MUARO JAMBI-MESTONG-PELEMPANG', 'Rapikan')
        discard_draft(self.user, str(moving.id))
        result = self.client.post('/admin/api/points/renumber', {'prefix': 'MUARO JAMBI-MESTONG-PELEMPANG', 'reason': 'Rapikan'},
            content_type='application/json', HTTP_X_CSRFTOKEN=self.client.get('/admin/api/session').json()['csrf'])
        self.assertEqual(result.status_code, 201, result.content)
        self.assertEqual(result.json()['renumbered'], 2)
        for item, nomor, revision in ((a, '001', 1), (b, '002', 2), (c, '003', 2)):
            item.refresh_from_db()
            self.assertEqual((item.nomor, item.state['nomor'], item.revision), (f'MUARO JAMBI-MESTONG-PELEMPANG-{nomor}',) * 2 + (revision,))
        self.assertEqual(Revision.objects.get(point=b, number=2).reason, 'Rapikan')
        self.assertEqual(AuditEvent.objects.filter(action='point.renumbered').count(), 2)
        active = ActivePublication.objects.get(id=1).publication
        self.assertIn('MUARO JAMBI-MESTONG-PELEMPANG-002', [f['properties']['Nomor'] for f in active.geojson['features']])
        self.assertEqual(self.client.get('/admin/api/points').json()['gaps'], ['MUARO JAMBI-MESTONG-TEMPINO'])


class PublicationCostTests(TestCase):
    def setUp(self):
        import tempfile
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        override = override_settings(STORAGE_BACKEND='filesystem', STORAGE_ROOT=self.directory.name)
        override.enable()
        self.addCleanup(override.disable)
        self.user = Account.objects.create_user(username='publish-owner', password='test-only-password-347192', role='owner')

    def add_points(self, count):
        import uuid
        from pathlib import Path
        from .models import Point, Photo
        folder = Path(self.directory.name) / 'display'
        folder.mkdir(exist_ok=True)
        for _ in range(count):
            photo_id = uuid.uuid4()
            (folder / photo_id.hex).write_bytes(b'jpeg')
            photo = Photo.objects.create(id=photo_id, original_key=f'originals/{photo_id.hex}', derivative_key=f'display/{photo_id.hex}',
                original_checksum='0' * 64, derivative_checksum='1' * 64, width=1, height=1, mime='image/jpeg', ready=True)
            nomor = f'KOTA JAMBI-KOTA BARU-PAAL LIMA-{Point.objects.count() + 1:03d}'
            state = {'nomor': nomor, 'nama': '', 'jalur': '', 'alamat': '', 'keterangan': '', 'lokasi_rekapan': '', 'catatan': '',
                'status': '', 'duplikat': False, 'archived': False, 'lon': 103.6, 'lat': -1.6, 'date': '', 'photo_id': str(photo.id), 'observation_id': None}
            point = Point.objects.create(nomor=nomor, state=state)
            Photo.objects.filter(id=photo.id).update(point=point)

    def publish_one_draft(self):
        from unittest import mock
        from django.db import connection
        from django.test.utils import CaptureQueriesContext
        from delivery import storage
        from .models import Point
        from .services import save_draft, publish
        point = Point.objects.order_by('nomor').first()
        draft = save_draft(self.user, str(point.id), point.revision, {'state': dict(point.state, catatan='Uji'), 'new_observation': None}, 'Uji')
        with mock.patch.object(storage, 'exists', wraps=storage.exists) as exists, CaptureQueriesContext(connection) as queries:
            publish(self.user, [str(draft.id)], 'Uji')
        return exists.call_count, len(queries)

    def test_republishing_skips_known_media_and_does_not_scale_with_points(self):
        from delivery.models import ActivePublication, MediaGrant
        from .services import publish_baseline
        ActivePublication.objects.get_or_create(id=1)
        self.add_points(3)
        publish_baseline(self.user, 'Uji')
        small = self.publish_one_draft()
        self.add_points(1)
        self.assertEqual(self.publish_one_draft()[0], 1, 'Only a photo published for the first time is checked in storage.')
        self.add_points(20)
        self.publish_one_draft()
        large = self.publish_one_draft()
        self.assertEqual((small[0], large[0]), (0, 0))
        self.assertEqual(small[1], large[1])
        active = ActivePublication.objects.get(id=1).publication
        self.assertEqual(MediaGrant.objects.filter(publication=active).count(), 24)
        self.assertEqual(len(active.manifest), 24)
