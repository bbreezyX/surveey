"""Private local operator helper. Never prints Railway credentials or passwords."""
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
from urllib.parse import urlparse, quote

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / '.local/railway-operator.json'
PROJECT = 'ebebdd21-0358-4ab1-a0d5-1afe4ee2673b'
ENVIRONMENT = '6abf965b-42d4-44ad-8b15-55c8be2adc76'
ADMIN = '55d8e517-529a-4985-bc66-0bad6f5e16d4'
POSTGRES = 'ca38ef07-1f75-4191-a905-af3a9af4a423'
BUCKET = '47e77464-c207-4932-b355-2d3773dd05bb'
CLI = [shutil.which('node'), str(Path(os.environ['APPDATA']) / 'npm/node_modules/@railway/cli/bin/railway.js')] if os.name == 'nt' else [shutil.which('railway')]
os.environ.update(RAILWAY_CALLER='skill:use-railway@1.3.6', RAILWAY_AGENT_SESSION='surveey-railway-20261009')

class ReconciliationError(Exception):
    pass

def railway(args, value=None):
    result = subprocess.run([*CLI, *args], input=value, capture_output=True, text=True, cwd=ROOT)
    if result.returncode:
        raise RuntimeError(f'Railway operation failed ({args[0]}). Credentials and command output withheld.')
    return result.stdout

def write_private(data):
    CONFIG.parent.mkdir(exist_ok=True)
    CONFIG.write_text(json.dumps(data), encoding='utf-8')
    if os.name == 'nt':
        subprocess.run(['icacls', str(CONFIG), '/inheritance:r', '/grant:r',
            f'{os.environ["USERDOMAIN"]}\\{os.environ["USERNAME"]}:(F)'], capture_output=True, check=True)
    else:
        CONFIG.chmod(0o600)

def configure_service(service, values):
    for name, value in values.items():
        railway(['variable', 'set', name, '--stdin', '--skip-deploys', '--service', service,
            '--environment', ENVIRONMENT, '--project', PROJECT], str(value))
    print(f'Configured {len(values)} variables for service {service}; values withheld.', flush=True)

def operator_env(data):
    env = {**os.environ, **data['admin']}
    env['DATABASE_URL'] = data['operator_database_url']
    env['RAILWAY_ENVIRONMENT_ID'] = ENVIRONMENT
    env.pop('SURVEY_ENV', None)
    return env

def main():
    action = sys.argv[1]
    if action == 'init':
        if CONFIG.exists():
            raise RuntimeError('Private configuration already exists; use subsequent actions.')
        variables = json.loads(railway(['variable', 'list', '--json', '--service', POSTGRES,
            '--environment', ENVIRONMENT, '--project', PROJECT]))
        bucket = json.loads(railway(['bucket', 'credentials', '--bucket', BUCKET,
            '--environment', ENVIRONMENT, '--json']))
        admin_password = secrets.token_urlsafe(48)
        public_password = secrets.token_urlsafe(48)
        admin = dict(SURVEY_DEPLOYMENT='railway', PORT='8080',
            DJANGO_SECRET_KEY=secrets.token_urlsafe(64), MEDIA_BROKER_TOKEN=secrets.token_urlsafe(64),
            ALLOWED_HOSTS='survey.esdm.cloud,surveypjuts-production.up.railway.app,survey-admin.railway.internal',
            ADMIN_ORIGIN='https://survey.esdm.cloud',
            PUBLIC_ORIGIN='https://survey-admin-production.up.railway.app',
            DATABASE_URL=f'postgresql://survey_admin_app:{quote(admin_password)}@postgres.railway.internal:5432/{variables["PGDATABASE"]}',
            DB_SSLMODE='require', S3_ENDPOINT=bucket['endpoint'], S3_BUCKET=bucket['bucketName'],
            S3_ACCESS_KEY=bucket['accessKeyId'], S3_SECRET_KEY=bucket['secretAccessKey'],
            S3_REGION=bucket['region'], S3_ADDRESSING_STYLE='virtual' if bucket['urlStyle'] == 'virtual-host' else 'path')
        parsed = urlparse(variables['DATABASE_URL'])
        operator_url = f'postgresql://{quote(parsed.username)}:{quote(parsed.password)}@iriguchi.proxy.rlwy.net:45176/{variables["PGDATABASE"]}'
        write_private(dict(admin=admin, admin_password=admin_password, public_password=public_password,
            public_database_url=f'postgresql://survey_public_app:{quote(public_password)}@postgres.railway.internal:5432/{variables["PGDATABASE"]}',
            operator_database_url=operator_url))
        print('Private operator configuration created; credentials were not printed.')
        return
    data = json.loads(CONFIG.read_text(encoding='utf-8'))
    if action == 'manage':
        result = subprocess.run([sys.executable, 'server/manage.py', *sys.argv[2:]], cwd=ROOT, env=operator_env(data))
        sys.exit(result.returncode)
    elif action in ('provision-owner', 'publish-baseline'):
        os.environ.update(operator_env(data))
        os.environ['DJANGO_SETTINGS_MODULE'] = 'config.admin_settings'
        sys.path.insert(0, str(ROOT / 'server'))
        import django
        django.setup()
        from django.db import transaction
        from django.contrib.auth.password_validation import validate_password
        from survey.models import Account
        from survey.services import audit, publish_baseline
        if action == 'provision-owner':
            if Account.objects.exists():
                raise RuntimeError('An account already exists; no replacement performed.')
            password = secrets.token_urlsafe(24)
            account = Account(username='danny', role='owner', is_active=True)
            validate_password(password, account)
            account.set_password(password)
            account.session_version = 1
            login_file = ROOT / '.local/railway-admin-login.txt'
            with login_file.open('x', encoding='utf-8') as stream:
                stream.write('Admin: https://survey-admin-production.up.railway.app\nUsername: danny\nInitial password: ' + password + '\n\nChange this password after signing in. Keep this file private.\n')
            if os.name == 'nt':
                subprocess.run(['icacls', str(login_file), '/inheritance:r', '/grant:r',
                    f'{os.environ["USERDOMAIN"]}\\{os.environ["USERNAME"]}:(F)'], capture_output=True, check=True)
            else:
                login_file.chmod(0o600)
            with transaction.atomic():
                account.save()
                audit(None, 'account.operator_provisioned', account.pk, after={'username': 'danny', 'role': 'owner'})
            print('Approved owner danny provisioned; initial password saved only in the private local login file.')
        else:
            publication = publish_baseline(Account.objects.get(username='danny', role='owner'),
                'Aktivasi baseline sumber saat penyambungan Railway; data dan bukti asli dipertahankan.')
            print(f'Baseline activated: {publication.id}; {len(publication.geojson["features"])} points.')
    elif action == 'roles':
        import psycopg
        from psycopg import sql
        with psycopg.connect(data['operator_database_url'], sslmode='require') as connection:
            connection.execute((ROOT / 'server/deploy/roles.sql').read_text())
            for name, group, password in [('survey_admin_app', 'survey_admin_write', data['admin_password']),
                    ('survey_public_app', 'survey_public_read', data['public_password'])]:
                connection.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(name), sql.Literal(password)))
                connection.execute(sql.SQL('GRANT {} TO {}').format(sql.Identifier(group), sql.Identifier(name)))
        print('Separate restricted database roles created.')
    elif action == 'configure-admin':
        configure_service(ADMIN, data['admin'])
    elif action == 'configure-public':
        configure_service(sys.argv[2], dict(SURVEY_DEPLOYMENT='railway', PORT='8080',
            DJANGO_SECRET_KEY=secrets.token_urlsafe(64), DATABASE_URL=data['public_database_url'], DB_SSLMODE='require',
            ALLOWED_HOSTS='survey.esdm.cloud,surveypjuts-production.up.railway.app', PUBLIC_ORIGIN='https://survey.esdm.cloud',
            MEDIA_BROKER_URL='http://survey-admin.railway.internal:9001', MEDIA_BROKER_TOKEN=data['admin']['MEDIA_BROKER_TOKEN']))
    elif action == 'inventory':
        import psycopg
        import re
        with psycopg.connect(data['operator_database_url'], sslmode='require') as connection:
            counts = connection.execute('SELECT (SELECT count(*) FROM survey_point), (SELECT count(*) FROM survey_photo), (SELECT count(*) FROM survey_observation), (SELECT count(*) FROM survey_revision)').fetchone()
            print(dict(zip(('points', 'photos', 'observations', 'revisions'), counts)))
            for state, wait, query in connection.execute("SELECT state, wait_event_type, query FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND usename='postgres' AND xact_start < now() - interval '2 minutes'").fetchall():
                table = re.search(r'(?:INTO|FROM|UPDATE)\s+"?([a-z_]+)', query)
                print('Operator transaction:', state, wait, table.group(1) if table else 'other')
    elif action == 'reconcile':
        import hashlib
        import datetime
        import psycopg
        source = json.loads((ROOT / 'data/points.geojson').read_text(encoding='utf-8'))['features']
        def check(condition, label):
            if not condition:
                raise ReconciliationError(label)
        with psycopg.connect(data['operator_database_url'], sslmode='require') as connection:
            rows = dict(connection.execute('SELECT nomor, state FROM survey_point').fetchall())
            photos = connection.execute('SELECT id, legacy_name, original_checksum FROM survey_photo').fetchall()
            photo_names = {str(row[0]): row[1] for row in photos}
            check(len(rows) == len(source) == 550 and len(photos) == 582, 'record counts')
            for feature in source:
                p = feature['properties']
                state = rows[p['Nomor']]
                check([state['lon'], state['lat']] == feature['geometry']['coordinates'][:2], 'point coordinate pair')
                for field, key in dict(nomor='Nomor', nama='Nama Anggota', jalur='Jalur', alamat='Alamat',
                        keterangan='Keterangan', lokasi_rekapan='Lokasi Rekapan', catatan='Catatan', status='Status').items():
                    check(state[field] == str(p.get(key) or '').strip(), f'point field {field}')
                check(state['duplikat'] == (str(p.get('Duplikat') or '').strip().lower() in ('true', 'ya', '1')), 'verification flag')
                if state['photo_id']:
                    raw_photo = str(p['Foto Survey Awal'])
                    # Legacy filename contract replaces Windows/path punctuation with underscores.
                    expected_photo = raw_photo.strip().replace('/', '_').replace('\\', '_').replace(':', '_')
                    check(photo_names[state['photo_id']] == expected_photo, 'normalized legacy photo link')
                if state['date']:
                    check(datetime.date.fromisoformat(state['date']).strftime('%d/%m/%Y') == p['Tanggal Dokumentasi'], 'observation date format')
            for _, name, checksum in photos:
                check(hashlib.sha256((ROOT / 'images' / name).read_bytes()).hexdigest() == checksum, 'original checksum')
        print('Reconciled all 550 point coordinates/data/photo/date links and all 582 original source checksums against Railway PostgreSQL.')
    elif action == 'permissions':
        import psycopg
        from urllib.parse import urlunparse
        for name in ('admin', 'public'):
            url = data['admin']['DATABASE_URL'] if name == 'admin' else data['public_database_url']
            parsed = urlparse(url)
            url = parsed._replace(netloc=f'{parsed.username}:{parsed.password}@iriguchi.proxy.rlwy.net:45176').geturl()
            with psycopg.connect(url, sslmode='require') as connection:
                checks = connection.execute("SELECT has_table_privilege(current_user, 'survey_account', 'SELECT'), has_table_privilege(current_user, 'delivery_publication', 'INSERT'), has_table_privilege(current_user, 'survey_revision', 'UPDATE')").fetchone()
                assert checks == ((True, True, False) if name == 'admin' else (False, False, False)), (name, checks)
                assert connection.execute('SELECT count(*) FROM delivery_activepublication').fetchone()[0] == 1
        print('Database role boundary verified: public cannot read accounts or write publications; neither role can rewrite revisions.')
    elif action == 'smoke-public':
        import hashlib
        import psycopg
        from urllib.request import urlopen, Request
        from urllib.error import HTTPError
        from urllib.parse import quote
        with psycopg.connect(data['operator_database_url'], sslmode='require') as connection:
            active = connection.execute('SELECT p.id, p.geojson, p.checksum FROM delivery_publication p JOIN delivery_activepublication a ON a.publication_id=p.id WHERE a.id=1').fetchone()
            records = connection.execute('SELECT id, checksum, derivative_key FROM delivery_publishedmedia WHERE revoked=false ORDER BY id LIMIT 3').fetchall()
            legacy_name = connection.execute('SELECT legacy_name FROM survey_photo WHERE point_id IS NOT NULL ORDER BY id LIMIT 1').fetchone()[0]
        def fetch(origin, path, headers=None):
            try:
                result = urlopen(Request(origin + path, headers=headers or {}), timeout=30)
            except HTTPError as result:
                return result.code, result.read(), {key.lower(): value for key, value in result.headers.items()}
            with result:
                return result.status, result.read(), {key.lower(): value for key, value in result.headers.items()}
        for origin in ('https://survey.esdm.cloud', 'https://surveypjuts-production.up.railway.app'):
            status, raw, headers = fetch(origin, '/data/points.geojson')
            assert status == 200 and json.loads(raw) == active[1]
            assert headers['x-publication-id'] == str(active[0])
            assert fetch(origin, '/data/points.geojson', {'If-None-Match': f'"{active[2]}"'})[0] == 304
            for path in ('/api/session', '/media/' + '0' * 32, '/images/' + quote(legacy_name)):
                assert fetch(origin, path)[0] == 404
            status, html, _ = fetch(origin, '/')
            assert status == 200
            import re
            asset = re.search(rb'src="([^"]+\.js)"', html).group(1).decode()
            status, script, _ = fetch(origin, asset)
            assert status == 200 and b'survey-admin' not in script and b'/api/accounts' not in script
            for secret in (data['admin']['DJANGO_SECRET_KEY'], data['admin']['MEDIA_BROKER_TOKEN'], data['admin']['S3_SECRET_KEY']):
                assert secret.encode() not in script
            for photo_id, checksum, key in records:
                status, image, headers = fetch(origin, '/media/' + photo_id.hex)
                assert status == 200 and headers['content-type'] == 'image/jpeg'
                assert hashlib.sha256(image).hexdigest() == checksum
                assert fetch(origin, '/media/' + photo_id.hex, {'If-None-Match': f'"{checksum}"'})[0] == 304
            print(f'Public smoke passed for {origin}: active snapshot/ETag, derivative checksums, old originals and root API routes denied, browser bundle contains no admin service secrets.', flush=True)
    elif action == 'smoke-admin':
        import re
        from http.cookiejar import CookieJar
        from urllib.request import Request, build_opener, HTTPCookieProcessor
        from urllib.error import HTTPError
        from urllib.parse import urlencode
        origin = data['admin']['ADMIN_ORIGIN']
        jar = CookieJar()
        client = build_opener(HTTPCookieProcessor(jar))
        def fetch(path, body=None, headers=None):
            try:
                result = client.open(Request(origin + path, data=body, headers=headers or {}), timeout=30)
            except HTTPError as result:
                return result.code, result.read(), dict(result.headers)
            with result:
                return result.status, result.read(), dict(result.headers)
        assert fetch('/admin/api/session')[0] == 401
        assert fetch('/admin/assets/missing.js')[0] == 401
        assert fetch('/admin/login', b'username=danny&password=invalid')[0] == 403
        status, html, headers = fetch('/admin/')
        assert status == 200
        assert headers['Cache-Control'] == 'private, no-store'
        token = re.search(rb'name="csrfmiddlewaretoken" value="([^"]+)"', html).group(1).decode()
        credentials = (ROOT / '.local/railway-admin-login.txt').read_text()
        password = credentials.split('Initial password: ', 1)[1].splitlines()[0]
        status, html, headers = fetch('/admin/login', urlencode(dict(username='danny', password=password,
            csrfmiddlewaretoken=token)).encode(), {'Content-Type': 'application/x-www-form-urlencoded', 'Origin': origin, 'Referer': origin + '/admin/'})
        assert status == 200 and b'/admin/assets/' in html
        cookies = {c.name: c for c in jar}
        assert cookies['survey_admin_session'].secure and cookies['survey_admin_session'].has_nonstandard_attr('HttpOnly')
        assert cookies['survey_admin_session']._rest.get('SameSite') == 'Strict'
        status, session, _ = fetch('/admin/api/session')
        session = json.loads(session)
        assert status == 200 and session['account']['username'] == 'danny' and session['account']['role'] == 'owner'
        assert fetch('/admin/api/points', b'{}', {'Content-Type': 'application/json'})[0] == 403
        status, points, _ = fetch('/admin/api/points')
        assert status == 200
        points = json.loads(points)
        assert points['total'] == 550
        assert points['counts'] == dict(total=550, official=500, cadangan=50, belum=2, duplikat=22)
        print('Live admin smoke passed: anonymous API/assets denied, CSRF enforced, owner login works, session cookie Secure/HttpOnly/Strict.', flush=True)
        print('Point list response fields:', ','.join(points.keys()), flush=True)
        status, _, _ = fetch('/admin/logout', b'', {'X-CSRFToken': session['csrf'], 'Origin': origin, 'Referer': origin + '/admin/'})
        assert status == 200 and fetch('/admin/api/session')[0] == 401
        print('Logout revoked access successfully.', flush=True)
    else:
        raise RuntimeError('Unknown operation.')

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        if isinstance(error, ReconciliationError):
            print(f'Reconciliation mismatch: {error}', file=sys.stderr)
        print(f'Operator action failed: {type(error).__name__}. Private values withheld.', file=sys.stderr)
        sys.exit(1)
