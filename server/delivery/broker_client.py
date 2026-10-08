import uuid
from urllib.request import Request, build_opener, ProxyHandler, HTTPRedirectHandler
from urllib.error import HTTPError, URLError
from django.conf import settings


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def get_published_media(media_id):
    identifier = uuid.UUID(str(media_id)).hex
    request = Request(f'{settings.MEDIA_BROKER_URL.rstrip("/")}/media/{identifier}',
        headers={'Authorization': f'Bearer {settings.MEDIA_BROKER_TOKEN}'})
    try:
        # Never route the private capability through an HTTP proxy or follow redirects.
        response = build_opener(ProxyHandler({}), NoRedirect()).open(request, timeout=30)
        if response.headers.get_content_type() != 'image/jpeg':
            response.close()
            raise ConnectionError('Invalid media response.')
        return response
    except HTTPError as error:
        error.close()
        if error.code == 404:
            raise FileNotFoundError from None
        raise ConnectionError('Media temporarily unavailable.') from None
    except URLError:
        raise ConnectionError('Media temporarily unavailable.') from None
