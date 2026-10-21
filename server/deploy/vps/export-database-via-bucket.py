"""One-shot Railway worker: read-only pg_dump, private HTTPS upload, then exit.

Run in a separate postgres:18-bookworm service, never in a production service.
The service needs Python 3 and two expiring, object-scoped presigned PUT URLs.
No network listener, source schema/data mutation, or validation step is used.
"""
import datetime
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

PROJECT = 'ebebdd21-0358-4ab1-a0d5-1afe4ee2673b'
ENVIRONMENT = '6abf965b-42d4-44ad-8b15-55c8be2adc76'
POSTGRES = 'ca38ef07-1f75-4191-a905-af3a9af4a423'
PRODUCTION_SERVICES = {POSTGRES, '55d8e517-529a-4985-bc66-0bad6f5e16d4',
    '873d72e9-1711-495d-b62d-825681972117', '09469b8d-578c-4c02-89dd-0b62de14d6ca'}


def timestamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def upload(url, source, length):
    if urllib.parse.urlsplit(url).scheme != 'https':
        raise ValueError('HTTPS upload is required.')
    request = urllib.request.Request(url, data=source, method='PUT', headers={
        'Content-Length': str(length), 'Content-Type': 'application/octet-stream'})
    with urllib.request.urlopen(request, timeout=300) as response:
        if response.status not in (200, 201, 204):
            raise RuntimeError('Archive upload did not complete.')


def main():
    if (os.environ.get('RAILWAY_PROJECT_ID') != PROJECT or
            os.environ.get('RAILWAY_ENVIRONMENT_ID') != ENVIRONMENT or
            not os.environ.get('RAILWAY_SERVICE_ID') or
            os.environ['RAILWAY_SERVICE_ID'] in PRODUCTION_SERVICES):
        raise RuntimeError('Use only a separate export service in the selected environment.')
    if not os.environ.get('PGHOST', '').endswith('.railway.internal'):
        raise RuntimeError('The export source must use Railway private networking.')
    if time.time() + 900 >= int(os.environ['EXPORT_EXPIRES_AT']):
        raise RuntimeError('Upload capability expires too soon; export was not started.')
    os.umask(0o077)
    directory = Path('/tmp/surveey-database-copy')
    directory.mkdir()
    archive = directory / 'survey.dump'
    environment = {**os.environ, 'PGSSLMODE': 'require', 'PGCONNECT_TIMEOUT': '20',
        'PGOPTIONS': '-c default_transaction_read_only=on', 'PGAPPNAME': 'surveey-copy-export'}
    started = timestamp()
    print(json.dumps({'phase': 'database_export_started', 'started_at_utc': started}), flush=True)
    with (directory / 'pg_dump.stderr').open('wb') as error_log:
        subprocess.run(['pg_dump', '--format=custom', '--compress=3', '--no-owner', '--no-acl',
            '--lock-wait-timeout=5000', '--file=' + str(archive)], env=environment,
            check=True, timeout=600, stdout=subprocess.DEVNULL, stderr=error_log)
    completed = timestamp()
    length = archive.stat().st_size
    with archive.open('rb') as source:
        upload(os.environ['EXPORT_ARCHIVE_PUT_URL'], source, length)
    metadata = {'source_project': PROJECT, 'source_environment': ENVIRONMENT,
        'source_service': POSTGRES, 'database_export_started_at_utc': started,
        'database_export_completed_at_utc': completed, 'database_dump_bytes': length,
        'format': 'PostgreSQL custom archive', 'source_data_mutations': 0,
        'tests_or_validation': 'Not performed'}
    payload = json.dumps(metadata, indent=2).encode()
    upload(os.environ['EXPORT_METADATA_PUT_URL'], payload, len(payload))
    print(json.dumps({'phase': 'database_export_uploaded', **metadata}), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # URL exceptions may contain signed capabilities; never log their text.
        print(json.dumps({'phase': 'export_failed', 'error_type': type(error).__name__,
            'http_status': error.code if isinstance(error, urllib.error.HTTPError) else None}),
            flush=True)
        sys.exit(1)
