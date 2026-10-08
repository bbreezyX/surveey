from .base import *

INSTALLED_APPS = ['django.contrib.auth', 'django.contrib.contenttypes', 'django.contrib.sessions', 'delivery', 'survey']
AUTH_USER_MODEL = 'survey.Account'
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator', 'OPTIONS': {'min_length': 15}},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]
PASSWORD_HASHERS = ['django.contrib.auth.hashers.Argon2PasswordHasher', 'django.contrib.auth.hashers.PBKDF2PasswordHasher']
MIDDLEWARE = ['django.middleware.security.SecurityMiddleware', 'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware', 'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware', 'django.middleware.clickjacking.XFrameOptionsMiddleware', 'survey.security.AdminBoundary']
ROOT_URLCONF = 'config.admin_urls'
WSGI_APPLICATION = 'config.admin_wsgi.application'
CSRF_FAILURE_VIEW = 'survey.views.csrf_failure'
ADMIN_BUILD = ROOT / 'dist/admin'

# Scope admin sessions to the admin path on the public-map hostname.
SESSION_COOKIE_NAME = 'survey_admin_session'
CSRF_COOKIE_NAME = 'survey_admin_csrf'
SESSION_COOKIE_PATH = '/admin/'
CSRF_COOKIE_PATH = '/admin/'
