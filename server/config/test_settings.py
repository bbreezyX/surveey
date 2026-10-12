"""Disposable backend tests, kept separate from local production connections."""
import os

if os.environ.get('RAILWAY_ENVIRONMENT_ID') or os.environ.get('SURVEY_DEPLOYMENT') == 'railway':
    raise RuntimeError('Test settings cannot run inside a production Railway environment.')
os.environ['SURVEY_ENV'] = 'local'
os.environ['DJANGO_SECRET_KEY'] = 'isolated-backend-tests-only-not-a-deployment-secret-' * 2
os.environ.pop('DATABASE_URL', None)

from .admin_settings import *
