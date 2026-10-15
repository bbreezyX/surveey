import hashlib
import io
import tempfile
import uuid
from pathlib import Path
from django.test import TestCase, SimpleTestCase, RequestFactory, override_settings
from .models import Publication, ActivePublication, PublishedMedia, MediaGrant
from . import views


class PrivateMediaBoundaryTests(TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.settings_override = override_settings(STORAGE_BACKEND='filesystem', STORAGE_ROOT=self.directory.name,
            MEDIA_BROKER_TOKEN='a' * 64)
        self.settings_override.enable()
        self.addCleanup(self.settings_override.disable)
        self.id = uuid.uuid4()
        folder = Path(self.directory.name) / 'display'
        folder.mkdir()
        (folder / self.id.hex).write_bytes(b'published jpeg fixture')
        publication = Publication.objects.create(geojson={}, checksum='1' * 64)
        ActivePublication.objects.update_or_create(id=1, defaults={'publication': publication})
        self.record = PublishedMedia.objects.create(id=self.id, derivative_key=f'display/{self.id.hex}',
            checksum=hashlib.sha256(b'published jpeg fixture').hexdigest(), mime='image/jpeg')
        MediaGrant.objects.create(publication=publication, media=self.record)
        self.factory = RequestFactory()

    def fetch(self, token=None, method='get'):
        headers = {'HTTP_AUTHORIZATION': f'Bearer {token}'} if token else {}
        request = getattr(self.factory, method)(f'/media/{self.id.hex}', **headers)
        response = views.broker_media(request, self.id.hex)
        self.addCleanup(response.close)
        return response

    def test_private_broker_denies_missing_or_wrong_capability(self):
        for token in (None, 'wrong-token', 'é'):
            response = self.fetch(token)
            self.assertEqual(response.status_code, 404)

    def test_valid_capability_serves_only_published_derivative(self):
        response = self.fetch('a' * 64)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(b''.join(response.streaming_content), b'published jpeg fixture')

    def test_revoked_media_is_denied_even_with_valid_capability(self):
        self.record.revoked = True
        self.record.save()
        self.assertEqual(self.fetch('a' * 64).status_code, 404)

    def test_original_keys_cannot_be_served(self):
        folder = Path(self.directory.name) / 'originals'
        folder.mkdir()
        (folder / self.id.hex).write_bytes(b'private original evidence')
        self.record.derivative_key = f'originals/{self.id.hex}'
        self.record.save()
        self.assertEqual(self.fetch('a' * 64).status_code, 404)

    def test_broker_cannot_accept_writes(self):
        self.assertEqual(self.fetch('a' * 64, 'post').status_code, 405)

    def test_readiness_requires_an_active_publication(self):
        request = self.factory.get('/health')
        response = views.readiness(request)
        self.assertEqual(response.status_code, 200)
        ActivePublication.objects.filter(id=1).update(publication=None)
        self.assertEqual(views.readiness(request).status_code, 503)


class MediaCacheTests(PrivateMediaBoundaryTests):
    def setUp(self):
        super().setUp()
        self.cache = tempfile.TemporaryDirectory()
        self.addCleanup(self.cache.cleanup)
        cache_override = override_settings(MEDIA_CACHE_ROOT=self.cache.name)
        cache_override.enable()
        self.addCleanup(cache_override.disable)
        self.stored = Path(self.directory.name) / 'display' / self.id.hex
        self.cached = Path(self.cache.name) / self.record.checksum

    def test_first_fetch_fills_cache_and_later_fetches_skip_storage(self):
        self.assertEqual(b''.join(self.fetch('a' * 64).streaming_content), b'published jpeg fixture')
        self.assertTrue(self.cached.is_file())
        self.stored.unlink()
        self.assertEqual(b''.join(self.fetch('a' * 64).streaming_content), b'published jpeg fixture')

    def test_revocation_removes_the_cached_copy(self):
        self.fetch('a' * 64)
        self.record.revoked = True
        self.record.save()
        self.assertEqual(self.fetch('a' * 64).status_code, 404)
        self.assertFalse(self.cached.exists())

    def test_bytes_that_do_not_match_the_checksum_are_not_cached(self):
        self.stored.write_bytes(b'tampered')
        self.assertEqual(self.fetch('a' * 64).status_code, 200)
        self.assertFalse(self.cached.exists())

    def test_warm_command_caches_the_active_publication(self):
        from django.core.management import call_command
        call_command('warm_media_cache', stdout=io.StringIO())
        self.assertEqual(self.cached.read_bytes(), b'published jpeg fixture')

    def test_warm_command_retries_while_the_broker_restarts(self):
        from unittest import mock
        from django.core.management import call_command
        from .management.commands import warm_media_cache
        attempts = iter([ConnectionError('broker restarting')])
        real_open = warm_media_cache.open_media
        def flaky_open(record):
            error = next(attempts, None)
            if error:
                raise error
            return real_open(record)
        with mock.patch.object(warm_media_cache, 'open_media', flaky_open), \
                mock.patch.object(warm_media_cache, 'ROUND_DELAY_SECONDS', 0):
            output = io.StringIO()
            call_command('warm_media_cache', stdout=output)
        self.assertIn('1/1 ready', output.getvalue())
        self.assertTrue(self.cached.is_file())


class StorageConnectionTests(SimpleTestCase):
    def test_manifest_checks_reuse_the_storage_connection(self):
        from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
        from threading import Thread
        from . import storage
        class Handler(BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'
            def setup(self):
                super().setup()
                self.server.connections += 1
            def do_HEAD(self):
                self.send_response(200)
                self.send_header('Content-Length', '0')
                self.end_headers()
            def log_message(self, *args):
                pass
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        server.daemon_threads = True
        server.connections = 0
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with override_settings(STORAGE_BACKEND='s3', S3_ENDPOINT=f'http://127.0.0.1:{server.server_port}',
                    S3_BUCKET='fixture', S3_ACCESS_KEY='fixture', S3_SECRET_KEY='fixture',
                    S3_REGION='auto', S3_ADDRESSING_STYLE='path'):
                self.assertTrue(storage.exists('display/' + '1' * 32))
                self.assertTrue(storage.exists('display/' + '2' * 32))
                self.assertEqual(server.connections, 1)
                storage.client().close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)
