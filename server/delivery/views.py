import json
import hmac
import re
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

@require_GET
def media(request, media_id):
    record = PublishedMedia.objects.filter(pk=media_id, revoked=False).first()
    if not record or (record.retain_until and record.retain_until <= timezone.now()):
        return HttpResponse(status=404)
    if not re.fullmatch(r'display/[0-9a-f]{32}', record.derivative_key):
        return HttpResponse(status=404)
    if not MediaGrant.objects.filter(media=record).exists():
        return HttpResponse(status=404)
    if record.retain_until is None and not MediaGrant.objects.filter(media=record,
            publication_id=ActivePublication.objects.values_list('publication_id', flat=True).get(id=1)).exists():
        return HttpResponse(status=404)
    etag = f'"{record.checksum}"'
    if request.headers.get('If-None-Match') == etag:
        response = HttpResponse(status=304)
        response['Cache-Control'] = 'public, max-age=0, must-revalidate'
        response['ETag'] = etag
        return response
    try:
        if settings.STORAGE_BACKEND == 'broker':
            from .broker_client import get_published_media
            stream = get_published_media(record.id)
        else:
            stream = storage.get(record.derivative_key)
        response = FileResponse(stream, content_type=record.mime)
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
