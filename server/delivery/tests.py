import hashlib
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
