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

    def test_local_admin_reads_vps_photos_over_ssh_without_bucket_credentials(self):
        import json
        database = {'DATABASE_URL': 'postgresql://survey_admin_app:fixture@127.0.0.1:15432/surveey', 'SURVEY_LOCAL_MEDIA': 'ssh'}
        missing = self.configure(database)
        self.assertNotEqual(missing.returncode, 0)
        self.assertIn('SSH_MEDIA_HOST', missing.stderr)
        result = self.configure({**database, 'SSH_MEDIA_HOST': 'operator@vps.test'})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {'database': 'django.db.backends.postgresql', 'storage': 'ssh'})


@override_settings(STORAGE_BACKEND='ssh', SSH_MEDIA_HOST='operator@vps.test')
class LocalVpsUploadTests(SimpleTestCase):
    def test_local_admin_rejects_uploads_before_touching_vps_media(self):
        from unittest import mock
        from .domain import Problem
        from .media import store_photo
        with mock.patch('delivery.storage.subprocess.run') as run, self.assertRaises(Problem) as raised:
            store_photo(b'not inspected', 'foto.jpg')
        run.assert_not_called()
        self.assertIn('admin produksi', raised.exception.message)


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
        # Each untidy desa comes with the active numbers it uses, for the list's indicator.
        self.assertEqual(self.client.get('/admin/api/points').json()['gaps'],
            {'MUARO JAMBI-MESTONG-PELEMPANG': [1, 3], 'MUARO JAMBI-MESTONG-TEMPINO': [1, 3]})
        self.assertEqual([item['state']['nomor'] for item in self.client.get('/admin/api/points?status=urut').json()['items']],
            ['MUARO JAMBI-MESTONG-PELEMPANG-001', 'MUARO JAMBI-MESTONG-PELEMPANG-003', 'MUARO JAMBI-MESTONG-TEMPINO-001', 'MUARO JAMBI-MESTONG-TEMPINO-003'])
        self.assertEqual([item['state']['nomor'] for item in self.client.get('/admin/api/points?status=urut&archived=1').json()['items']],
            ['MUARO JAMBI-MESTONG-PELEMPANG-001', 'MUARO JAMBI-MESTONG-PELEMPANG-003', 'MUARO JAMBI-MESTONG-PELEMPANG-004', 'MUARO JAMBI-MESTONG-TEMPINO-001', 'MUARO JAMBI-MESTONG-TEMPINO-003'])
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
        self.assertEqual(self.client.get('/admin/api/points').json()['gaps'], {'MUARO JAMBI-MESTONG-TEMPINO': [1, 3]})
        self.assertEqual([item['state']['nomor'] for item in self.client.get('/admin/api/points?status=urut').json()['items']],
            ['MUARO JAMBI-MESTONG-TEMPINO-001', 'MUARO JAMBI-MESTONG-TEMPINO-003'])

    def test_archived_points_leave_a_gap_and_move_behind_the_active_ones(self):
        from delivery.models import ActivePublication
        from .models import Point
        from .services import create_point, renumber
        ActivePublication.objects.get_or_create(id=1)
        ture = 'Desa Ture, Kecamatan Pemayung, Kabupaten Batang Hari'
        def point(number, archived):
            created = create_point(self.user, {'nomor': f'BATANG HARI-PEMAYUNG-TURE-{number}', 'nama': '', 'jalur': '', 'alamat': ture,
                'keterangan': '', 'lokasi_rekapan': '', 'catatan': '', 'status': '', 'duplikat': False, 'archived': False,
                'lon': 103.4, 'lat': -1.55, 'date': '', 'photo_id': None, 'observation_id': None}, 'Uji')
            Point.objects.filter(pk=created.pk).update(state={**created.state, 'archived': archived}, archived=archived)
            return created
        # 002 was archived once its desa was settled. The public map then jumps
        # from 001 to 003, so the desa needs tidying even though every number is held.
        first, settled, third, fourth = point('001', False), point('002', True), point('003', False), point('004', False)
        self.client.get('/admin/')
        token = self.client.cookies['survey_admin_csrf'].value
        self.client.post('/admin/login', {'username': self.user.username, 'password': 'test-only-password-347192', 'csrfmiddlewaretoken': token})
        self.assertEqual(self.client.get('/admin/api/points').json()['gaps'], {'BATANG HARI-PEMAYUNG-TURE': [1, 3, 4]})
        # The list asks for no reason; the revision still records the tidying.
        renumbered, publication = renumber(self.user, 'BATANG HARI-PEMAYUNG-TURE', '')
        # Active units close up to 001..N; the archive keeps a unique number behind them.
        self.assertEqual(renumbered, 3)
        for item, nomor in ((first, '001'), (third, '002'), (fourth, '003'), (settled, '004')):
            item.refresh_from_db()
            self.assertEqual((item.nomor, item.state['nomor']), (f'BATANG HARI-PEMAYUNG-TURE-{nomor}',) * 2)
        self.assertEqual(sorted(f['properties']['Nomor'][-3:] for f in publication.geojson['features']), ['001', '002', '003'])
        self.assertEqual(self.client.get('/admin/api/points').json()['gaps'], {})
        self.assertEqual(third.revisions.get(number=third.revision).reason, 'Rapikan nomor unit BATANG HARI-PEMAYUNG-TURE')


    def test_next_nomor_for_a_picked_address_counts_points_and_reserved_drafts(self):
        from .services import create_point, save_draft
        def point(nomor, alamat):
            return create_point(self.user, {'nomor': nomor, 'nama': '', 'jalur': '', 'alamat': alamat, 'keterangan': '', 'lokasi_rekapan': '',
                'catatan': '', 'status': '', 'duplikat': False, 'archived': False, 'lon': 103.5, 'lat': -1.8, 'date': '', 'photo_id': None, 'observation_id': None}, 'Uji')
        pelempang = 'Desa Pelempang, Kecamatan Mestong, Kabupaten Muaro Jambi'
        point('MUARO JAMBI-MESTONG-PELEMPANG-001', pelempang)
        point('MUARO JAMBI-MESTONG-PELEMPANG-003', pelempang)
        mover = point('MUARO JAMBI-MESTONG-TEMPINO-001', 'Kel. Tempino, Kecamatan Mestong, Kabupaten Muaro Jambi')
        save_draft(self.user, str(mover.id), mover.revision, {'state': dict(mover.state, alamat=pelempang), 'new_observation': None}, 'Pindah')
        self.client.get('/admin/')
        token = self.client.cookies['survey_admin_csrf'].value
        self.client.post('/admin/login', {'username': self.user.username, 'password': 'test-only-password-347192', 'csrfmiddlewaretoken': token})
        nomor = lambda alamat: self.client.get('/admin/api/points/next-nomor', {'alamat': alamat}).json()['nomor']
        # 004 is held by the pending draft moving Tempino-001 in.
        self.assertEqual(nomor(pelempang), 'MUARO JAMBI-MESTONG-PELEMPANG-005')
        self.assertEqual(nomor('Kel. Tempino, Kecamatan Mestong, Kabupaten Muaro Jambi'), 'MUARO JAMBI-MESTONG-TEMPINO-002')
        self.assertEqual(nomor('Desa Suka Damai, Kecamatan Mestong, Kabupaten Muaro Jambi'), 'MUARO JAMBI-MESTONG-SUKA DAMAI-001')
        self.assertIsNone(nomor('RT 21 Rawasari, Kota Jambi'))

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
        draft = save_draft(self.user, str(point.id), point.revision, {'state': dict(point.state, catatan=f'Uji {point.revision + 1}'), 'new_observation': None}, 'Uji')
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


class DirectPublishAndOptionalReasonTests(TestCase):
    def setUp(self):
        self.owner = Account.objects.create_user(username='direct-owner', password='test-only-password-347192', role='owner')
        self.editor = Account.objects.create_user(username='direct-editor', password='test-only-password-347193', role='editor')
        self.client = Client(enforce_csrf_checks=True)

    def login(self, username, password):
        self.client.get('/admin/')
        token = self.client.cookies['survey_admin_csrf'].value
        self.client.post('/admin/login', {'username': username, 'password': password, 'csrfmiddlewaretoken': token})
        return self.client.get('/admin/api/session').json()['csrf']

    def test_optional_reason_autofills_and_publisher_can_publish_directly(self):
        from delivery.models import ActivePublication
        from .models import Draft, Point, Revision
        from .services import create_point, publish_baseline, save_draft
        ActivePublication.objects.get_or_create(id=1)
        state = {'nomor': 'KOTA JAMBI-KOTA BARU-PAAL LIMA-001', 'nama': '', 'jalur': '', 'alamat': 'Kel. Paal Lima, Kecamatan Kota Baru, Kota Jambi',
            'keterangan': '', 'lokasi_rekapan': '', 'catatan': '', 'status': '', 'duplikat': False, 'archived': False,
            'lon': 103.6, 'lat': -1.6, 'date': '', 'photo_id': None, 'observation_id': None}
        point = create_point(self.owner, state, 'Uji')
        Point.objects.filter(pk=point.pk).update(state={**point.state, 'archived': False}, archived=False)
        point.refresh_from_db()
        publish_baseline(self.owner, 'Baseline')

        # Optional reason on draft auto-summarizes coordinate movement.
        own_draft = save_draft(self.owner, str(point.id), point.revision,
            {'state': {**point.state, 'lat': -1.60015}, 'new_observation': None}, '')
        self.assertRegex(own_draft.reason, r'^Geser koordinat \d+ m$')
        other_draft = save_draft(self.editor, str(point.id), point.revision,
            {'state': {**point.state, 'catatan': 'Catatan editor'}, 'new_observation': None}, '')
        self.assertEqual(other_draft.reason, 'Koreksi data titik')

        # Editor role cannot publish directly.
        editor_csrf = self.login(self.editor.username, 'test-only-password-347193')
        denied = self.client.post(f'/admin/api/points/{point.id}/publish',
            {'base_revision': point.revision, 'proposed': {'state': {**point.state, 'lat': -1.6002}, 'new_observation': None}, 'reason': ''},
            content_type='application/json', HTTP_X_CSRFTOKEN=editor_csrf)
        self.assertEqual(denied.status_code, 403)

        # Owner can publish directly with an empty reason; own pending draft closes, other user's draft remains pending.
        owner_csrf = self.login(self.owner.username, 'test-only-password-347192')
        published = self.client.post(f'/admin/api/points/{point.id}/publish',
            {'base_revision': point.revision, 'proposed': {'state': {**point.state, 'lat': -1.6002}, 'new_observation': None}, 'reason': ''},
            content_type='application/json', HTTP_X_CSRFTOKEN=owner_csrf)
        self.assertEqual(published.status_code, 201, published.content)
        point.refresh_from_db()
        own_draft.refresh_from_db()
        other_draft.refresh_from_db()
        self.assertEqual(point.revision, 2)
        self.assertEqual(point.state['lat'], -1.6002)
        self.assertEqual(own_draft.status, 'published')
        self.assertEqual(other_draft.status, 'pending')
        self.assertRegex(Revision.objects.get(point=point, number=2).reason, r'^Geser koordinat \d+ m$')
        active = ActivePublication.objects.get(id=1).publication
        self.assertEqual(active.geojson['features'][0]['geometry']['coordinates'], [103.6, -1.6002])

        # Stale base_revision returns 409 without changing active publication.
        conflict = self.client.post(f'/admin/api/points/{point.id}/publish',
            {'base_revision': 1, 'proposed': {'state': {**point.state, 'lat': -1.6005}, 'new_observation': None}, 'reason': ''},
            content_type='application/json', HTTP_X_CSRFTOKEN=owner_csrf)
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(Draft.objects.filter(point=point, status='pending').count(), 1)

    def test_batch_publish_accepts_blank_reason(self):
        from delivery.models import ActivePublication
        from .models import Point
        from .services import create_point, publish, publish_baseline, save_draft
        ActivePublication.objects.get_or_create(id=1)
        state = {'nomor': 'KOTA JAMBI-KOTA BARU-PAAL LIMA-002', 'nama': '', 'jalur': '', 'alamat': 'Kel. Paal Lima, Kecamatan Kota Baru, Kota Jambi',
            'keterangan': '', 'lokasi_rekapan': '', 'catatan': '', 'status': '', 'duplikat': False, 'archived': False,
            'lon': 103.6, 'lat': -1.6, 'date': '', 'photo_id': None, 'observation_id': None}
        point = create_point(self.owner, state, 'Uji')
        Point.objects.filter(pk=point.pk).update(state={**point.state, 'archived': False}, archived=False)
        point.refresh_from_db()
        publish_baseline(self.owner, 'Baseline')
        draft = save_draft(self.owner, str(point.id), point.revision,
            {'state': {**point.state, 'catatan': 'Baru'}, 'new_observation': None}, '')
        publication = publish(self.owner, [str(draft.id)], '')
        self.assertEqual(str(ActivePublication.objects.get(id=1).publication_id), str(publication.id))


class AdminLogicImprovementTests(TestCase):
    def setUp(self):
        import tempfile
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        override = override_settings(STORAGE_BACKEND='filesystem', STORAGE_ROOT=self.directory.name)
        override.enable()
        self.addCleanup(override.disable)
        self.owner = Account.objects.create_user(username='logic-owner', password='test-only-password-347192', role='owner')
        self.editor = Account.objects.create_user(username='logic-editor', password='test-only-password-347193', role='editor')
        self.client = Client(enforce_csrf_checks=True)

    def login(self, username, password):
        self.client.get('/admin/')
        token = self.client.cookies['survey_admin_csrf'].value
        self.client.post('/admin/login', {'username': username, 'password': password, 'csrfmiddlewaretoken': token})
        return self.client.get('/admin/api/session').json()['csrf']

    def make_point(self, nomor, **extra):
        from .models import Point, Revision
        state = {
            'nomor': nomor, 'nama': '', 'jalur': '', 'alamat': 'Desa Pelempang, Kecamatan Mestong, Kabupaten Muaro Jambi',
            'keterangan': '', 'lokasi_rekapan': '', 'catatan': '', 'status': '', 'duplikat': False, 'archived': False,
            'lon': 103.5, 'lat': -1.78, 'date': '', 'photo_id': None, 'observation_id': None, **extra,
        }
        point = Point.objects.create(nomor=nomor, state=state, archived=state['archived'])
        Revision.objects.create(point=point, number=1, state=state, actor=self.owner, reason='Awal')
        return point

    def jpeg_bytes(self, size=(200, 100), orientation=None):
        import io
        from PIL import Image
        buf = io.BytesIO()
        img = Image.new('RGB', size, 'blue')
        if orientation:
            exif = img.getexif()
            exif[274] = orientation
            img.save(buf, format='JPEG', exif=exif)
        else:
            img.save(buf, format='JPEG')
        return buf.getvalue()

    def test_search_matches_lokasi_rekapan_catatan_multiword_and_coordinates_and_clamps_page(self):
        self.make_point('MUARO JAMBI-MESTONG-PELEMPANG-001', lokasi_rekapan='Simpang Masjid Al-Falah', lat=-1.781234, lon=103.512345)
        self.make_point('Muaro Jambi-Mestong-Pelempang-002', catatan='Tiang dekat jembatan', lat=-1.79, lon=103.52)
        self.login(self.owner.username, 'test-only-password-347192')

        by_rekapan = self.client.get('/admin/api/points', {'q': 'Masjid Al-Falah'}).json()
        self.assertEqual([i['state']['nomor'] for i in by_rekapan['items']], ['MUARO JAMBI-MESTONG-PELEMPANG-001'])

        by_catatan = self.client.get('/admin/api/points', {'q': 'jembatan'}).json()
        self.assertEqual([i['state']['nomor'] for i in by_catatan['items']], ['Muaro Jambi-Mestong-Pelempang-002'])

        by_multi = self.client.get('/admin/api/points', {'q': 'mestong 002'}).json()
        self.assertEqual([i['state']['nomor'] for i in by_multi['items']], ['Muaro Jambi-Mestong-Pelempang-002'])

        by_coord = self.client.get('/admin/api/points', {'q': '-1.78123, 103.51235'}).json()
        self.assertEqual([i['state']['nomor'] for i in by_coord['items']], ['MUARO JAMBI-MESTONG-PELEMPANG-001'])

        by_swapped = self.client.get('/admin/api/points', {'q': '103.51235, -1.78123'}).json()
        self.assertEqual([i['state']['nomor'] for i in by_swapped['items']], ['MUARO JAMBI-MESTONG-PELEMPANG-001'])

        clamped = self.client.get('/admin/api/points', {'page': 99}).json()
        self.assertEqual((clamped['page'], clamped['pages'], len(clamped['items'])), (1, 1, 2))
        self.assertEqual([i['state']['nomor'] for i in clamped['items']],
            ['MUARO JAMBI-MESTONG-PELEMPANG-001', 'Muaro Jambi-Mestong-Pelempang-002'])

    def test_filters_for_drafts_tanpa_foto_and_nomors(self):
        from .services import save_draft
        p1 = self.make_point('MUARO JAMBI-MESTONG-PELEMPANG-001', archived=True)
        p2 = self.make_point('MUARO JAMBI-MESTONG-PELEMPANG-002')
        save_draft(self.editor, str(p1.id), p1.revision, {'state': {**p1.state, 'archived': False}, 'new_observation': None}, 'Aktivasi')
        self.login(self.owner.username, 'test-only-password-347192')

        draft_list = self.client.get('/admin/api/points', {'status': 'drafts'}).json()
        self.assertEqual([i['state']['nomor'] for i in draft_list['items']], [p1.nomor])
        self.assertEqual(draft_list['pending_drafts'], 1)
        self.assertEqual(draft_list['missing_photo'], 1)

        no_photo = self.client.get('/admin/api/points', {'status': 'tanpa_foto'}).json()
        self.assertEqual([i['state']['nomor'] for i in no_photo['items']], [p2.nomor])

        by_nomors = self.client.get('/admin/api/points', {'nomors': p2.nomor}).json()
        self.assertEqual([i['state']['nomor'] for i in by_nomors['items']], [p2.nomor])

    def test_revoke_photo_detaches_active_point_republishes_and_blocks_reuse(self):
        from delivery.models import ActivePublication, PublishedMedia
        from .domain import Problem
        from .media import store_photo
        from .services import publish_baseline, publish_point, revoke_photo, save_draft
        ActivePublication.objects.get_or_create(id=1)
        p1 = self.make_point('MUARO JAMBI-MESTONG-PELEMPANG-001')
        p2 = self.make_point('MUARO JAMBI-MESTONG-PELEMPANG-002')
        photo = store_photo(self.jpeg_bytes(), 'bukti.jpg', self.owner, p1, 'image/jpeg')
        p1.state['photo_id'] = str(photo.id)
        p1.save(update_fields=['state'])
        publish_baseline(self.owner, 'Baseline')

        detached = revoke_photo(self.owner, str(photo.id), 'Privasi warga')
        self.assertEqual(detached, 1)
        p1.refresh_from_db()
        self.assertIsNone(p1.state['photo_id'])
        self.assertEqual(p1.revision, 2)
        self.assertTrue(PublishedMedia.objects.get(id=photo.id).revoked)

        # Active publication drops the revoked URL, and unrelated points still publish cleanly.
        active = ActivePublication.objects.get(id=1).publication
        p1_feature = next(f for f in active.geojson['features'] if f['properties']['Nomor'] == p1.nomor)
        self.assertEqual(p1_feature['properties']['Foto Survey Awal'], '')
        publish_point(self.owner, str(p2.id), p2.revision, {'state': {**p2.state, 'catatan': 'Lanjut'}, 'new_observation': None}, 'Edit p2')

        # Re-attaching the revoked photo or revoking again is rejected.
        with self.assertRaises(Problem):
            save_draft(self.owner, str(p1.id), p1.revision, {'state': {**p1.state, 'photo_id': str(photo.id)}, 'new_observation': None}, 'Pakai lagi')
        with self.assertRaises(Problem):
            revoke_photo(self.owner, str(photo.id), 'Ulang')

    def test_noop_guards_restore_replaces_own_draft_and_create_checks_reserved_nomors(self):
        from .domain import Problem
        from .models import Draft
        from .services import create_point, publish_point, restore_draft, save_draft
        from delivery.models import ActivePublication
        ActivePublication.objects.get_or_create(id=1)
        p1 = self.make_point('MUARO JAMBI-MESTONG-PELEMPANG-001')
        with self.assertRaises(Problem):
            save_draft(self.owner, str(p1.id), p1.revision, {'state': dict(p1.state), 'new_observation': None}, 'Kosong')
        with self.assertRaises(Problem):
            publish_point(self.owner, str(p1.id), p1.revision, {'state': dict(p1.state), 'new_observation': None}, 'Kosong')
        with self.assertRaises(Problem):
            restore_draft(self.owner, str(p1.id), 1, p1.revision, 'Sudah sama')

        # Create a second revision, then restore twice -> updates the single pending draft.
        publish_point(self.owner, str(p1.id), p1.revision, {'state': {**p1.state, 'catatan': 'V2'}, 'new_observation': None}, 'Ubah')
        p1.refresh_from_db()
        first_restore = restore_draft(self.owner, str(p1.id), 1, p1.revision, 'Pulih 1')
        second_restore = restore_draft(self.owner, str(p1.id), 1, p1.revision, 'Pulih 2')
        self.assertEqual(first_restore.id, second_restore.id)
        self.assertEqual(Draft.objects.filter(point=p1, author=self.owner, status='pending').count(), 1)

        # Case-insensitive duplicate and pending-draft reserved Nomor are both rejected on create_point.
        with self.assertRaises(Problem):
            create_point(self.owner, {**p1.state, 'nomor': p1.nomor.lower(), 'archived': True}, 'Duplikat huruf kecil')
        mover = self.make_point('MUARO JAMBI-MESTONG-TEMPINO-001', alamat='Kel. Tempino, Kecamatan Mestong, Kabupaten Muaro Jambi')
        moving = save_draft(self.owner, str(mover.id), mover.revision,
            {'state': {**mover.state, 'alamat': 'Desa Pelempang, Kecamatan Mestong, Kabupaten Muaro Jambi'}, 'new_observation': None}, 'Pindah')
        reserved_nomor = moving.proposed['state']['nomor']
        with self.assertRaises(Problem):
            create_point(self.owner, {**p1.state, 'nomor': reserved_nomor, 'archived': True}, 'Tabrak draf')

    def test_upload_rate_bucket_is_separate_from_browsing_and_media_decode_uses_output_dimensions(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        from .domain import Problem
        from .media import decode
        p1 = self.make_point('MUARO JAMBI-MESTONG-PELEMPANG-001')
        csrf = self.login(self.owner.username, 'test-only-password-347192')
        for _ in range(35):
            self.assertEqual(self.client.get('/admin/api/session').status_code, 200)
        upload = SimpleUploadedFile('foto.jpg', self.jpeg_bytes((400, 200), orientation=6), content_type='application/octet-stream')
        uploaded = self.client.post('/admin/api/photos', {'point_id': str(p1.id), 'file': upload}, HTTP_X_CSRFTOKEN=csrf)
        self.assertEqual(uploaded.status_code, 201, uploaded.content)
        # Orientation 6 swaps 400x200 to 200x400 after exif_transpose.
        self.assertEqual((uploaded.json()['width'], uploaded.json()['height']), (200, 400))
        with self.assertRaises(Problem):
            decode(self.jpeg_bytes(), 'foto.jpg', 'image/png')

    def test_publications_audit_and_self_account_update(self):
        from delivery.models import ActivePublication
        from .services import publish_baseline
        ActivePublication.objects.get_or_create(id=1)
        p1 = self.make_point('MUARO JAMBI-MESTONG-PELEMPANG-001')
        publish_baseline(self.owner, 'Terbit awal')
        csrf = self.login(self.owner.username, 'test-only-password-347192')

        pubs = self.client.get('/admin/api/publications').json()
        self.assertEqual(pubs['items'][0]['points'], 1)
        self.assertEqual(pubs['items'][0]['actor'], self.owner.username)
        self.assertEqual(pubs['items'][0]['reason'], 'Terbit awal')

        # Audit filter resolves target_label to Nomor and searches by Nomor.
        from .services import publish_point
        publish_point(self.owner, str(p1.id), p1.revision, {'state': {**p1.state, 'duplikat': True}, 'new_observation': None}, '')
        audit = self.client.get('/admin/api/audit', {'action': 'point.published', 'q': p1.nomor}).json()
        self.assertEqual(len(audit['items']), 1)
        self.assertEqual(audit['items'][0]['target_label'], p1.nomor)
        self.assertEqual(audit['items'][0]['reason'], 'Tandai perlu verifikasi')

        # Case-insensitive duplicate account creation is rejected.
        dup = self.client.post('/admin/api/accounts',
            {'username': 'LOGIC-OWNER', 'name': 'Dup', 'role': 'editor', 'password': 'unique-strong-password-987654'},
            content_type='application/json', HTTP_X_CSRFTOKEN=csrf)
        self.assertEqual(dup.status_code, 409)

        # No-op account PATCH is rejected; self password change keeps current owner session alive.
        noop = self.client.patch(f'/admin/api/accounts/{self.owner.pk}',
            {'enabled': True, 'role': 'owner', 'password': '', 'reason': 'Tidak berubah'},
            content_type='application/json', HTTP_X_CSRFTOKEN=csrf)
        self.assertEqual(noop.status_code, 400)

        self_patch = self.client.patch(f'/admin/api/accounts/{self.owner.pk}',
            {'enabled': True, 'role': 'owner', 'password': 'new-owner-strong-password-456789', 'reason': 'Rotasi sandi'},
            content_type='application/json', HTTP_X_CSRFTOKEN=csrf)
        self.assertEqual(self_patch.status_code, 200, self_patch.content)
        self.assertEqual(self.client.get('/admin/api/accounts').status_code, 200)

    def test_unattached_legacy_photo_requires_publish_permission_and_missing_file_returns_404(self):
        from .media import store_photo
        photo = store_photo(self.jpeg_bytes(), 'legacy.jpg', None, None, 'image/jpeg')
        self.login(self.editor.username, 'test-only-password-347193')
        self.assertEqual(self.client.get(f'/admin/api/photos/{photo.id}/display').status_code, 403)
        self.login(self.owner.username, 'test-only-password-347192')
        ok = self.client.get(f'/admin/api/photos/{photo.id}/display')
        self.assertEqual(ok.status_code, 200)
        ok.close()
        from pathlib import Path
        (Path(self.directory.name) / photo.derivative_key).unlink()
        self.assertEqual(self.client.get(f'/admin/api/photos/{photo.id}/display').status_code, 404)

    def test_esdm_sync_webhook_notifies_on_commit_and_retries(self):
        import json
        from unittest.mock import MagicMock, patch
        from django.test import override_settings
        from delivery.models import ActivePublication
        from .services import notify_esdm_sync, renumber

        ActivePublication.objects.get_or_create(id=1)
        self.make_point('TJT-KJ-MAJELIS-002')
        with patch('survey.services.schedule_esdm_sync') as scheduled:
            with self.captureOnCommitCallbacks(execute=True):
                count, pub = renumber(self.owner, 'TJT-KJ-MAJELIS', 'Rapikan')
            self.assertEqual(count, 1)
            scheduled.assert_called_once_with(str(pub.id), pub.checksum, 'Rapikan')

        resp = MagicMock()
        resp.status = 200
        resp.__enter__.return_value = resp
        calls = []
        def fake_urlopen(req, timeout=None):
            calls.append((req.full_url, req.get_header('Authorization'), json.loads(req.data.decode()), timeout))
            if len(calls) == 1:
                raise OSError('transient error')
            return resp

        with override_settings(ESDM_SYNC_URL='https://www.esdm.cloud/api/cron/survey-sync', ESDM_SYNC_TOKEN='secret-token', ESDM_SYNC_TIMEOUT=5):
            with patch('survey.services.urllib.request.urlopen', side_effect=fake_urlopen):
                ok = notify_esdm_sync(pub.id, pub.checksum, 'Rapikan', retries=2, sleep=lambda _s: None)
        self.assertTrue(ok)
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0][0], 'https://www.esdm.cloud/api/cron/survey-sync')
        self.assertEqual(calls[0][1], 'Bearer secret-token')
        self.assertEqual(calls[0][2]['publication'], str(pub.id))
        self.assertEqual(calls[0][2]['checksum'], pub.checksum)
        self.assertEqual(calls[0][2]['trigger'], 'surveey-publish')
        self.assertEqual(calls[0][3], 5)

    def test_batch_archive_publish_draft_permissions_and_conflicts(self):
        from unittest.mock import patch
        from delivery.models import ActivePublication, Publication
        from .models import AuditEvent, Draft, Revision
        from .services import publish_baseline, save_draft

        ActivePublication.objects.get_or_create(id=1)
        p1 = self.make_point('MUARO JAMBI-MESTONG-PELEMPANG-001')
        p2 = self.make_point('MUARO JAMBI-MESTONG-PELEMPANG-002', status='Cadangan')
        p3 = self.make_point('MUARO JAMBI-MESTONG-PELEMPANG-003')
        p_arch = self.make_point('MUARO JAMBI-MESTONG-PELEMPANG-004', archived=True)
        publish_baseline(self.owner, 'Terbit awal')
        pubs_before = Publication.objects.count()

        # Editor cannot batch-publish, but can batch-draft.
        editor_csrf = self.login(self.editor.username, 'test-only-password-347193')
        forbidden = self.client.post('/admin/api/points/batch-archive', {
            'items': [{'id': str(p1.id), 'base_revision': p1.revision}],
            'reason': 'Coba terbit',
            'mode': 'publish',
        }, content_type='application/json', HTTP_X_CSRFTOKEN=editor_csrf)
        self.assertEqual(forbidden.status_code, 403)

        # Save an existing editor draft on p1 first to verify batch draft updates it in place.
        existing = save_draft(self.editor, str(p1.id), p1.revision,
            {'state': {**p1.state, 'catatan': 'Catatan lama'}, 'new_observation': None}, 'Edit dulu')
        draft_res = self.client.post('/admin/api/points/batch-archive', {
            'items': [
                {'id': str(p1.id), 'base_revision': p1.revision},
                {'id': str(p2.id), 'base_revision': p2.revision},
            ],
            'reason': 'Usulan arsip massal',
            'mode': 'draft',
        }, content_type='application/json', HTTP_X_CSRFTOKEN=editor_csrf)
        self.assertEqual(draft_res.status_code, 201, draft_res.content)
        self.assertEqual(draft_res.json()['archived'], 2)
        self.assertEqual(draft_res.json()['mode'], 'draft')
        self.assertEqual(Draft.objects.filter(point=p1, author=self.editor, status='pending').count(), 1)
        existing.refresh_from_db()
        self.assertTrue(existing.proposed['state']['archived'])
        self.assertEqual(existing.reason, 'Usulan arsip massal')
        # Points stay active until published.
        p1.refresh_from_db()
        p2.refresh_from_db()
        self.assertFalse(p1.archived)
        self.assertFalse(p2.archived)

        # Owner batch-publishes p1 and p2 atomically in a single publication.
        owner_csrf = self.login(self.owner.username, 'test-only-password-347192')
        owner_draft = save_draft(self.owner, str(p1.id), p1.revision,
            {'state': {**p1.state, 'catatan': 'Draf pemilik'}, 'new_observation': None}, 'Draf pemilik')
        with patch('survey.services.schedule_esdm_sync') as scheduled:
            with self.captureOnCommitCallbacks(execute=True):
                pub_res = self.client.post('/admin/api/points/batch-archive', {
                    'items': [
                        {'id': str(p1.id), 'base_revision': p1.revision},
                        {'id': str(p2.id), 'base_revision': p2.revision},
                    ],
                    'reason': 'Pengalihan lokasi 2 titik',
                    'mode': 'publish',
                }, content_type='application/json', HTTP_X_CSRFTOKEN=owner_csrf)
        self.assertEqual(pub_res.status_code, 201, pub_res.content)
        body = pub_res.json()
        self.assertEqual((body['archived'], body['mode']), (2, 'publish'))
        self.assertEqual(Publication.objects.count(), pubs_before + 1)
        scheduled.assert_called_once()

        p1.refresh_from_db()
        p2.refresh_from_db()
        owner_draft.refresh_from_db()
        self.assertTrue(p1.archived and p1.state['archived'] and p1.revision == 2)
        self.assertTrue(p2.archived and p2.state['archived'] and p2.revision == 2)
        self.assertEqual(owner_draft.status, 'published')
        self.assertEqual(Revision.objects.filter(point=p1, number=2).get().reason, 'Pengalihan lokasi 2 titik')
        self.assertTrue(AuditEvent.objects.filter(action='point.published', target=str(p2.id)).exists())
        active_pub = ActivePublication.objects.get(id=1).publication
        published_nomors = [f['properties']['Nomor'] for f in active_pub.geojson['features']]
        self.assertEqual(published_nomors, [p3.nomor])

        # Stale revision or already-archived point fails atomically with 409 and leaves p3 untouched.
        stale = self.client.post('/admin/api/points/batch-archive', {
            'items': [
                {'id': str(p3.id), 'base_revision': p3.revision},
                {'id': str(p1.id), 'base_revision': 1},
            ],
            'reason': '',
            'mode': 'publish',
        }, content_type='application/json', HTTP_X_CSRFTOKEN=owner_csrf)
        self.assertEqual(stale.status_code, 409)
        p3.refresh_from_db()
        self.assertFalse(p3.archived)

        already_arch = self.client.post('/admin/api/points/batch-archive', {
            'items': [{'id': str(p_arch.id), 'base_revision': p_arch.revision}],
            'reason': '',
            'mode': 'publish',
        }, content_type='application/json', HTTP_X_CSRFTOKEN=owner_csrf)
        self.assertEqual(already_arch.status_code, 409)

        # Empty list, duplicates, and invalid mode return 400.
        for payload in (
            {'items': [], 'reason': '', 'mode': 'publish'},
            {'items': [{'id': str(p3.id), 'base_revision': p3.revision}, {'id': str(p3.id), 'base_revision': p3.revision}], 'reason': '', 'mode': 'publish'},
            {'items': [{'id': str(p3.id), 'base_revision': p3.revision}], 'reason': '', 'mode': 'invalid'},
        ):
            bad = self.client.post('/admin/api/points/batch-archive', payload,
                content_type='application/json', HTTP_X_CSRFTOKEN=owner_csrf)
            self.assertEqual(bad.status_code, 400, payload)
