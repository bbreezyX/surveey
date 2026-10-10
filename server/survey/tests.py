from django.test import TestCase, Client, override_settings
from .models import Account


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
