import os
from pathlib import Path
from urllib.parse import urlparse, unquote
from django.core.exceptions import ImproperlyConfigured

ROOT = Path(__file__).resolve().parents[2]
LOCAL = os.environ.get('SURVEY_ENV') == 'local'
RAILWAY = os.environ.get('SURVEY_DEPLOYMENT') == 'railway'
if RAILWAY and (LOCAL or not os.environ.get('RAILWAY_ENVIRONMENT_ID')):
    raise ImproperlyConfigured('Railway deployment requires an actual Railway environment and production mode.')
DEBUG = False

def required(name):
    value = os.environ.get(name, '').strip()
    if not value:
        raise ImproperlyConfigured(f'{name} is required; no production fallback is provided.')
    return value

SECRET_KEY = required('DJANGO_SECRET_KEY')
if len(SECRET_KEY) < 50:
    raise ImproperlyConfigured('DJANGO_SECRET_KEY must contain at least 50 characters.')
ALLOWED_HOSTS = ['127.0.0.1', 'localhost', 'testserver'] if LOCAL else required('ALLOWED_HOSTS').split(',')
if not LOCAL and any(host == '*' or host.startswith('.') or not host.strip() for host in ALLOWED_HOSTS):
    raise ImproperlyConfigured('ALLOWED_HOSTS must contain explicit hostnames, without wildcards.')
if RAILWAY:
    ALLOWED_HOSTS = list(dict.fromkeys([*ALLOWED_HOSTS, 'healthcheck.railway.app']))
public_service = os.environ.get('DJANGO_SETTINGS_MODULE') == 'config.public_settings'
origin_variable = 'PUBLIC_ORIGIN' if public_service else 'ADMIN_ORIGIN'
origins = ['http://127.0.0.1:8130', 'http://localhost:8130'] if LOCAL else required(origin_variable).split(',')
if not LOCAL and any(not o.startswith('https://') for o in origins):
    raise ImproperlyConfigured(f'{origin_variable} must use HTTPS.')
if not LOCAL:
    for origin in origins:
        parsed_origin = urlparse(origin)
        if parsed_origin.hostname not in ALLOWED_HOSTS or parsed_origin.path not in ('', '/') or parsed_origin.username or parsed_origin.query or parsed_origin.fragment:
            raise ImproperlyConfigured(f'{origin_variable} must match an explicit allowed hostname and contain no credentials/path/query.')
CSRF_TRUSTED_ORIGINS = origins
DATABASE_URL = os.environ.get('DATABASE_URL', '')
if DATABASE_URL:
    db = urlparse(DATABASE_URL)
    if db.scheme not in ('postgres', 'postgresql'):
        raise ImproperlyConfigured('DATABASE_URL must use PostgreSQL.')
    DATABASES = {'default': {'ENGINE': 'django.db.backends.postgresql', 'NAME': unquote(db.path.lstrip('/')),
        'USER': unquote(db.username or ''), 'PASSWORD': unquote(db.password or ''), 'HOST': db.hostname,
        'PORT': db.port or 5432, 'CONN_MAX_AGE': 60, 'OPTIONS': {'sslmode': os.environ.get('DB_SSLMODE', 'require')}}}
elif LOCAL:
    (ROOT / '.local').mkdir(exist_ok=True)
    # Every API request writes its throttle row and session. With SQLite's
    # default deferred transactions, two threads that both read then write
    # fail at once with "database is locked" (the busy timeout does not apply
    # to a lock upgrade). IMMEDIATE takes the write lock up front, so they queue.
    DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ROOT / '.local/survey.sqlite3',
        'OPTIONS': {'transaction_mode': 'IMMEDIATE', 'timeout': 20}}}
else:
    raise ImproperlyConfigured('DATABASE_URL is required outside explicit local mode.')
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
USE_TZ = True
TIME_ZONE = 'Asia/Jakarta'
LANGUAGE_CODE = 'id'
SESSION_COOKIE_NAME = 'survey_session'
SESSION_COOKIE_SECURE = not LOCAL
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Strict'
SESSION_COOKIE_AGE = 1800
SESSION_SAVE_EVERY_REQUEST = True
CSRF_COOKIE_NAME = 'survey_csrf'
CSRF_COOKIE_SECURE = not LOCAL
CSRF_COOKIE_HTTPONLY = True
CSRF_COOKIE_SAMESITE = 'Strict'
SECURE_SSL_REDIRECT = not LOCAL
# Deliberately do not trust forwarded headers. TLS terminates at a private,
# trusted reverse proxy that connects to this service over TLS in production.
SECURE_HSTS_SECONDS = 31536000 if not LOCAL else 0
SECURE_HSTS_INCLUDE_SUBDOMAINS = False
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = 'same-origin'
X_FRAME_OPTIONS = 'DENY'
DATA_UPLOAD_MAX_MEMORY_SIZE = 1024 * 1024
DATA_UPLOAD_MAX_NUMBER_FIELDS = 40
DATA_UPLOAD_MAX_NUMBER_FILES = 1
FILE_UPLOAD_MAX_MEMORY_SIZE = 1024 * 1024
STORAGE_BACKEND = 'filesystem' if LOCAL else 's3'
STORAGE_ROOT = ROOT / '.local/private-media'
MEDIA_BROKER_TOKEN = os.environ.get('MEDIA_BROKER_TOKEN', '')
MEDIA_BROKER_URL = os.environ.get('MEDIA_BROKER_URL', '')
broker_client = RAILWAY and public_service
if broker_client:
    parsed_broker = urlparse(required('MEDIA_BROKER_URL'))
    if (parsed_broker.scheme != 'http' or not parsed_broker.hostname or
            not parsed_broker.hostname.endswith('.railway.internal') or parsed_broker.port != 9001 or
            parsed_broker.username or parsed_broker.password or parsed_broker.path not in ('', '/') or
            parsed_broker.query or parsed_broker.fragment):
        raise ImproperlyConfigured('MEDIA_BROKER_URL must address the private Railway media port only.')
    STORAGE_BACKEND = 'broker'
if RAILWAY and len(MEDIA_BROKER_TOKEN) < 50:
    raise ImproperlyConfigured('A private MEDIA_BROKER_TOKEN of at least 50 characters is required.')
if not LOCAL and not broker_client:
    S3_ENDPOINT = required('S3_ENDPOINT')
    if not S3_ENDPOINT.startswith('https://'):
        raise ImproperlyConfigured('S3_ENDPOINT must use HTTPS.')
    S3_BUCKET = required('S3_BUCKET')
    S3_ACCESS_KEY = required('S3_ACCESS_KEY')
    S3_SECRET_KEY = required('S3_SECRET_KEY')
    S3_REGION = os.environ.get('S3_REGION', 'auto')
    S3_ADDRESSING_STYLE = os.environ.get('S3_ADDRESSING_STYLE', 'virtual')
    if S3_ADDRESSING_STYLE not in ('virtual', 'path'):
        raise ImproperlyConfigured('S3_ADDRESSING_STYLE must be virtual or path.')
TEMPLATES = [{'BACKEND': 'django.template.backends.django.DjangoTemplates', 'DIRS': [ROOT / 'server/templates'],
              'APP_DIRS': False, 'OPTIONS': {}}]
