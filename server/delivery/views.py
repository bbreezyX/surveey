import hashlib
import io
import json
import hmac
import os
import re
import threading
from contextlib import closing
from pathlib import Path
from django.conf import settings
from django.http import HttpResponse, FileResponse, JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_GET
from .models import ActivePublication, PublishedMedia, MediaGrant
from . import storage

@require_GET
def readiness(request):
    ready = ActivePublication.objects.filter(id=1, publication__isnull=False).exists()
    return HttpResponse(status=200 if ready else 503)

@require_GET
def points(request):
    active = ActivePublication.objects.select_related('publication').filter(id=1).first()
    if not active or not active.publication_id:
        return JsonResponse({'error': 'Belum ada data yang diterbitkan.'}, status=503)
    publication = active.publication
    etag = f'"{publication.checksum}"'
    if request.headers.get('If-None-Match') == etag:
        response = HttpResponse(status=304)
    else:
        response = HttpResponse(json.dumps(publication.geojson, ensure_ascii=False, separators=(',', ':')), content_type='application/geo+json')
    response['ETag'] = etag
    response['Cache-Control'] = 'public, max-age=0, must-revalidate'
    response['X-Publication-ID'] = str(publication.id)
    return response

# Display derivatives are ~130 KB; anything far larger is not a derivative we published.
MAX_MEDIA_BYTES = 20 * 1024 * 1024


def cached_path(record):
    if not settings.MEDIA_CACHE_ROOT or not re.fullmatch(r'[0-9a-f]{64}', record.checksum):
        return None
    # Keyed by content checksum, so a cached file can never answer for different bytes.
    return Path(settings.MEDIA_CACHE_ROOT) / record.checksum


def discard_cached(record):
    path = cached_path(record)
    if path:
        path.unlink(missing_ok=True)


def open_stored(record):
    if settings.STORAGE_BACKEND == 'broker':
        from .broker_client import get_published_media
        return get_published_media(record.id)
    return storage.get(record.derivative_key)


def open_media(record):
    """Return a readable file for the derivative, filling the local cache on a miss."""
    path = cached_path(record)
    if path is None:
        return open_stored(record)
    try:
        return path.open('rb')
    except FileNotFoundError:
        pass
    with closing(open_stored(record)) as stream:
        content = stream.read(MAX_MEDIA_BYTES + 1)
    if len(content) > MAX_MEDIA_BYTES:
        raise ConnectionError('Media larger than any published derivative.')
    if hashlib.sha256(content).hexdigest() == record.checksum:
        path.parent.mkdir(parents=True, exist_ok=True)
        # Atomic rename: concurrent workers and the warm-up command may fill the same entry.
        temporary = path.with_name(f'.{path.name}.{os.getpid()}.{threading.get_ident()}')
        temporary.write_bytes(content)
        os.replace(temporary, path)
    # A checksum mismatch is served as before but never cached.
    return io.BytesIO(content)


@require_GET
def media(request, media_id):
    record = PublishedMedia.objects.filter(pk=media_id).first()
    if not record:
        return HttpResponse(status=404)
    if (record.revoked or (record.retain_until and record.retain_until <= timezone.now())
            or not re.fullmatch(r'display/[0-9a-f]{32}', record.derivative_key)
            or not MediaGrant.objects.filter(media=record).exists()
            or (record.retain_until is None and not MediaGrant.objects.filter(media=record,
                publication_id=ActivePublication.objects.values_list('publication_id', flat=True).get(id=1)).exists())):
        # Revocation must also drop the local copy, not just stop serving it.
        discard_cached(record)
        return HttpResponse(status=404)
    etag = f'"{record.checksum}"'
    if request.headers.get('If-None-Match') == etag:
        response = HttpResponse(status=304)
        response['Cache-Control'] = 'public, max-age=0, must-revalidate'
        response['ETag'] = etag
        return response
    try:
        response = FileResponse(open_media(record), content_type=record.mime)
    except FileNotFoundError:
        return HttpResponse(status=404)
    except (TimeoutError, ConnectionError):
        return HttpResponse(status=503)
    # Revocable content is deliberately revalidated; a cached response must not defeat privacy revocation.
    response['Cache-Control'] = 'public, max-age=0, must-revalidate'
    response['ETag'] = etag
    response['X-Content-Type-Options'] = 'nosniff'
    return response


@require_GET
def broker_media(request, media_id):
    expected = settings.MEDIA_BROKER_TOKEN
    supplied = request.headers.get('Authorization', '')
    if len(expected) < 50 or not hmac.compare_digest(supplied.encode('utf-8'), f'Bearer {expected}'.encode('utf-8')):
        return HttpResponse(status=404)
    return media(request, media_id)
