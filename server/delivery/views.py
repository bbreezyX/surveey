import json
import hmac
import re
from django.conf import settings
from django.http import HttpResponse, FileResponse, JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_GET
from django.db.models import Exists, OuterRef, Subquery
from .models import ActivePublication, PublishedMedia, MediaGrant
from . import storage
from .media_cache import MAX_MEDIA_BYTES, cache_path, open_cached

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

def cached_path(record):
    return cache_path(settings.MEDIA_CACHE_ROOT, record.checksum)


def discard_cached(record):
    path = cached_path(record)
    if path:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            # Authorization still denies access even if the disposable cache
            # cannot be cleaned at this instant.
            pass


def open_stored(record):
    if settings.STORAGE_BACKEND == 'broker':
        from .broker_client import get_published_media
        return get_published_media(record.id)
    return storage.get(record.derivative_key)


def open_media(record):
    """Return a readable file for the derivative, filling the local cache on a miss."""
    return open_cached(settings.MEDIA_CACHE_ROOT, record.checksum, lambda: open_stored(record), MAX_MEDIA_BYTES)


@require_GET
def media(request, media_id):
    grants = MediaGrant.objects.filter(media_id=OuterRef('pk'))
    active = ActivePublication.objects.filter(id=1).values('publication_id')[:1]
    # Validate publication access in the same round trip as the media lookup.
    # These checks also run before a cache hit or a conditional 304 response.
    record = PublishedMedia.objects.annotate(has_grant=Exists(grants),
        has_active_grant=Exists(grants.filter(publication_id=Subquery(active)))).filter(pk=media_id).first()
    if not record:
        return HttpResponse(status=404)
    if (record.revoked or (record.retain_until and record.retain_until <= timezone.now())
            or not re.fullmatch(r'display/[0-9a-f]{32}', record.derivative_key)
            or not record.has_grant
            or (record.retain_until is None and not record.has_active_grant)):
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
