from .public_settings import *

# Runs inside the admin container on an unexposed private port. Only the
# derivative capability endpoint is registered; no data, login or admin routes.
ROOT_URLCONF = 'delivery.broker_urls'
WSGI_APPLICATION = 'config.media_wsgi.application'
if VPS:
    # The capability-only listener is bound to loopback, behind the public TLS service.
    SECURE_SSL_REDIRECT = False
