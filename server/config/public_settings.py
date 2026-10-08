from .base import *

# This process uses separate SELECT-only credentials and contains no admin URLconf,
# account app, session middleware, password login or administrative API.
INSTALLED_APPS = ['delivery']
MIDDLEWARE = ['django.middleware.security.SecurityMiddleware', 'django.middleware.common.CommonMiddleware']
ROOT_URLCONF = 'delivery.urls'
WSGI_APPLICATION = 'config.public_wsgi.application'
# The Railway variant is reachable only through encrypted private networking;
# its external HTTPS boundary is the public-map proxy. It has no session/login.
if RAILWAY:
    SECURE_SSL_REDIRECT = False
