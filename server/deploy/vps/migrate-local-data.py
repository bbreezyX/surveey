"""Explicit one-time Surveey migration. Credentials arrive on stdin; never logged.

Run prepare, then cutover with the same identifier under the Surveey resource
slice. Railway is retained and fenced. This is not an application deploy hook.
"""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import pwd
import re
import shutil
import subprocess
import sys
import tarfile
import time
from urllib.parse import quote, urlsplit

import boto3
from botocore.config import Config
import psycopg
from psycopg import sql
from psycopg.rows import dict_row

BASE = Path('/srv/surveey')
PRIVATE = BASE / 'private'
PGROOT = BASE / 'runtime/postgres'
BIN = PGROOT / 'usr/lib/postgresql/18/bin'
DATA = BASE / 'postgres-production'
UNITS = ['surveey-admin.service', 'surveey-public.service',
         'surveey-broker.service', 'surveey-edge.service']
ROLES = ['survey_admin_app', 'survey_public_app']


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def emit(phase, **values):
    print(json.dumps({'phase': phase, 'at_utc': now(), **values}), flush=True)


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        while block := stream.read(1024 * 1024):
            h.update(block)
    return h.hexdigest()


def atomic(path, content, mode=0o600):
    temporary = path.with_name(path.name + '.migration-incoming')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    with os.fdopen(fd, 'w') as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def save(path, value):
    atomic(path, json.dumps(value, default=str, indent=2) + '\n')


def run(args, label, environment=None, input=None, timeout=180):
    result = subprocess.run(args, env=environment, input=input, capture_output=True,
                            text=True, timeout=timeout)
    log = WORK / (label + '.log')
    log.write_text(result.stdout + '\n' + result.stderr)
    log.chmod(0o600)
    if result.returncode:
        raise RuntimeError('Operation failed: ' + label + '; private log retained')
    return result.stdout.strip()


def live_env(name):
    pid = subprocess.check_output(['systemctl', 'show', 'surveey-' + name + '.service',
                                  '--property=MainPID', '--value'], text=True).strip()
    if not pid or pid == '0':
        raise RuntimeError('Expected existing Surveey process: ' + name)
    return dict(s.split('=', 1) for s in Path('/proc', pid, 'environ').read_bytes()
                .decode().split('\0') if '=' in s)


def protected():
    result = {'units': {}, 'files': {}}
    for unit in ['niskala-udara.service', 'caddy.service']:
        result['units'][unit] = subprocess.check_output(['systemctl', 'show', unit,
            '--property=MainPID,ActiveState,ActiveEnterTimestamp'], text=True)
    for name in ['/etc/caddy/Caddyfile', '/etc/systemd/system/niskala-udara.service']:
        path = Path(name)
        if path.exists():
            result['files'][name] = digest(path)
    return result


def connect_source(readonly=False):
    return psycopg.connect(host=STATE['source_host'], port=STATE['source_port'],
        dbname=SOURCE['PGDATABASE'], user=SOURCE['PGUSER'], password=SOURCE['PGPASSWORD'],
        sslmode='require', connect_timeout=15, autocommit=True, row_factory=dict_row,
        application_name='surveey-data-migration',
        options='-c default_transaction_read_only=' + ('on' if readonly else 'off') +
                ' -c statement_timeout=120000 -c lock_timeout=5000')


def connect_target(database='postgres'):
    return psycopg.connect(host='127.0.0.1', port=15433, dbname=database,
        user='surveey_operator', password=TARGET['operator_password'], sslmode='require',
        connect_timeout=10, autocommit=True, row_factory=dict_row,
        application_name='surveey-data-migration',
        options='-c statement_timeout=120000 -c lock_timeout=5000')


def pg_env(source=False):
    values = dict(os.environ, LD_LIBRARY_PATH=str(PGROOT / 'usr/lib/x86_64-linux-gnu'),
        PGSSLMODE='require', PGCONNECT_TIMEOUT='15', PGAPPNAME='surveey-data-migration')
    if source:
        values.update(PGHOST=STATE['source_host'], PGPORT=str(STATE['source_port']),
            PGUSER=SOURCE['PGUSER'], PGPASSWORD=SOURCE['PGPASSWORD'], PGDATABASE=SOURCE['PGDATABASE'],
            PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=120000')
    else:
        values.update(PGHOST='127.0.0.1', PGPORT='15433', PGUSER='surveey_operator',
            PGPASSWORD=TARGET['operator_password'], PGDATABASE='surveey')
    return values


def export(name):
    path = WORK / name
    if path.exists():
        raise RuntimeError('Refusing to overwrite a database export')
    run([str(BIN / 'pg_dump'), '--format=custom', '--compress=3', '--no-owner',
         '--lock-wait-timeout=5000', '--file=' + str(path)], name, pg_env(True))
    path.chmod(0o600)
    if path.stat().st_size == 0:
        raise RuntimeError('Empty database export')
    return {'file': path.name, 'bytes': path.stat().st_size, 'sha256': digest(path)}


def fingerprint(connection):
    result = {'tables': {}, 'sequences': {}, 'privileges': {}}
    with connection.transaction():
        connection.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        # JSON timestamp rendering follows the session timezone; normalize both
        # servers before comparing the underlying restored values.
        connection.execute("SET LOCAL TIME ZONE 'UTC'")
        connection.execute("SET LOCAL DateStyle='ISO, YMD'")
        tables = connection.execute("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename").fetchall()
        for item in tables:
            name = item['tablename']
            query = sql.SQL('SELECT to_jsonb(t)::text AS row FROM {} t ORDER BY to_jsonb(t)::text COLLATE "C"').format(sql.Identifier('public', name))
            h, count = hashlib.sha256(), 0
            for row in connection.execute(query):
                raw = row['row'].encode()
                h.update(len(raw).to_bytes(8, 'big'))
                h.update(raw)
                count += 1
            result['tables'][name] = {'rows': count, 'sha256': h.hexdigest()}
            for role in ROLES:
                result['privileges'][role + ':' + name] = connection.execute(
                    "SELECT has_table_privilege(%s,%s,p) AS allowed FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p",
                    (role, 'public.' + name)).fetchall()
        sequences = connection.execute("SELECT sequencename FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename").fetchall()
        for item in sequences:
            name = item['sequencename']
            result['sequences'][name] = connection.execute(sql.SQL('SELECT last_value,is_called FROM {}').format(sql.Identifier('public', name))).fetchone()
            for role in ROLES:
                result['privileges'][role + ':' + name] = connection.execute(
                    "SELECT has_sequence_privilege(%s,%s,p) AS allowed FROM unnest(ARRAY['USAGE','SELECT','UPDATE']) p",
                    (role, 'public.' + name)).fetchall()
    return result


def snapshot_config():
    backup = WORK / 'configuration'
    backup.mkdir(mode=0o700)
    paths = [PRIVATE / (name + '.env') for name in ['admin', 'public', 'broker']]
    paths += [Path('/etc/systemd/system') / (name + '.service') for name in
              ['surveey-admin', 'surveey-public', 'surveey-broker', 'surveey-edge', 'surveey-postgres']]
    paths += [Path('/usr/local/libexec/surveey-release.py')]
    for i, path in enumerate(paths):
        copy = backup / (str(i) + '-' + path.name)
        shutil.copy2(path, copy)
        copy.chmod(0o600)
        STATE['configuration'].append({'path': str(path), 'backup': str(copy), 'sha256': digest(path),
            'mode': path.stat().st_mode & 0o777})


def prepare():
    if DATA.exists() or (BASE / 'FULL_VPS_CONFIGURED.json').exists():
        raise RuntimeError('A production target already exists; refusing to overwrite')
    envs = {name: live_env(name) for name in ['admin', 'public', 'broker']}
    if any(e.get('SURVEY_DATA_SOURCE') != 'railway' for e in envs.values()):
        raise RuntimeError('Expected the current Railway-data deployment')
    url = urlsplit(envs['admin']['DATABASE_URL'])
    STATE.update(phase='preparing', started_at_utc=now(), configuration=[],
        release=str((BASE / 'current').resolve()), source_host=url.hostname, source_port=url.port,
        protected_before=protected())
    snapshot_config()
    save(WORK / 'source-environments.private.json', envs)
    with connect_source(True) as source:
        identity = source.execute("SELECT current_database() AS database,current_setting('server_version') AS version").fetchone()
        if identity['database'] != 'railway' or not identity['version'].startswith('18.'):
            raise RuntimeError('Unexpected source identity')
        STATE['source_identity'] = identity
        STATE['source_roles'] = source.execute("SELECT rolname,rolcanlogin,rolsuper FROM pg_roles WHERE rolname !~ '^pg_' ORDER BY rolname").fetchall()
        if {r['rolname'] for r in STATE['source_roles']} != {'postgres','survey_admin_app','survey_public_app','survey_admin_write','survey_public_read'}:
            raise RuntimeError('Additional source roles need explicit restore handling')
        settings = source.execute("SELECT s.setconfig FROM pg_db_role_setting s JOIN pg_database d ON d.oid=s.setdatabase WHERE d.datname=current_database() AND s.setrole=0").fetchone()
        STATE['source_database_settings'] = settings['setconfig'] if settings else []
    STATE['preparation_dump'] = export('before-pause.dump')
    save(WORK / 'state.json', STATE)
    emit('source_backup_created', **STATE['preparation_dump'])
    account = pwd.getpwnam('surveey-db')
    DATA.mkdir(mode=0o700)
    os.chown(DATA, account.pw_uid, account.pw_gid)
    pwfile = BASE / 'run' / ('initdb-password-' + IDENTIFIER)
    pwfile.write_text(TARGET['operator_password'] + '\n')
    pwfile.chmod(0o600)
    os.chown(pwfile, account.pw_uid, account.pw_gid)
    try:
        run(['runuser','-u','surveey-db','--',str(BIN / 'initdb'),'-D',str(DATA),
             '-L',str(PGROOT / 'usr/share/postgresql/18'),'--username=surveey_operator',
             '--auth-local=peer','--auth-host=scram-sha-256','--encoding=UTF8','--locale=en_US.utf8',
             '--pwfile=' + str(pwfile)], 'initdb', pg_env())
    finally:
        pwfile.unlink(missing_ok=True)
    run(['openssl','req','-x509','-newkey','rsa:3072','-sha256','-noenc','-days','365',
         '-subj','/CN=surveey-private-db','-keyout',str(DATA / 'server.key'),
         '-out',str(DATA / 'server.crt')], 'database-tls')
    for name in ['server.key','server.crt']:
        os.chown(DATA / name, account.pw_uid, account.pw_gid)
        (DATA / name).chmod(0o600)
    with (DATA / 'postgresql.conf').open('a') as stream:
        stream.write("\nlisten_addresses='127.0.0.1'\nport=15433\nunix_socket_directories='/srv/surveey/run'\n"
            "shared_buffers='32MB'\nwork_mem='2MB'\nmaintenance_work_mem='32MB'\nmax_connections=30\n"
            "max_parallel_workers=1\nmax_worker_processes=4\nmax_wal_size='128MB'\nmin_wal_size='32MB'\n"
            "ssl=on\nssl_cert_file='server.crt'\nssl_key_file='server.key'\nlog_min_messages=warning\n"
            "timezone='UTC'\nlog_timezone='UTC'\n")
    unit = next(x for x in STATE['configuration'] if x['path'].endswith('/surveey-postgres.service'))
    content = Path(unit['backup']).read_text().replace(str(BASE / 'postgres'), str(DATA))
    atomic(Path(unit['path']), content, 0o644)
    run(['systemctl','daemon-reload'], 'prepare-daemon-reload')
    run(['systemctl','start','surveey-postgres.service'], 'start-new-cluster')
    finish_prepare()


def finish_prepare():
    with connect_target() as target:
        # Keep source ACL references without creating an additional superuser.
        target.execute('CREATE ROLE postgres NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE')
        for group in ['survey_admin_write','survey_public_read']:
            target.execute(sql.SQL('CREATE ROLE {} NOLOGIN').format(sql.Identifier(group)))
        for role, key, group in [('survey_admin_app','admin_password','survey_admin_write'),
                                  ('survey_public_app','public_password','survey_public_read')]:
            target.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(role),sql.Literal(TARGET[key])))
            target.execute(sql.SQL('GRANT {} TO {}').format(sql.Identifier(group),sql.Identifier(role)))
    STATE['phase'] = 'prepared'
    save(WORK / 'state.json', STATE)
    emit('prepared', source_backup=STATE['preparation_dump'], target_cluster=str(DATA), production_unchanged=True)


def fence(source):
    with source.transaction():
        for role in ROLES:
            source.execute(sql.SQL('ALTER ROLE {} NOLOGIN').format(sql.Identifier(role)))
    STATE['source_fenced'] = True
    save(WORK / 'state.json', STATE)
    emit('source_logins_fenced', waiting_for='Railway admin writer graceful drain')
    receipt = WORK / 'railway-writer-drained.json'
    deadline = time.monotonic() + 120
    while not receipt.exists():
        if time.monotonic() > deadline:
            raise RuntimeError('Railway writer drain receipt was not received; source sessions retained')
        time.sleep(0.5)
    STATE['railway_writer_drain'] = json.loads(receipt.read_text())
    if not STATE['railway_writer_drain'].get('writer_processes_drained'):
        raise RuntimeError('Railway admin writer did not drain')
    source.execute(sql.SQL("ALTER DATABASE {} SET default_transaction_read_only='on'").format(sql.Identifier(SOURCE['PGDATABASE'])))
    source.execute('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()')


def unfreeze(source):
    prior = next((x.split('=',1)[1] for x in STATE['source_database_settings'] if x.startswith('default_transaction_read_only=')), None)
    with source.transaction():
        if prior is None:
            source.execute(sql.SQL('ALTER DATABASE {} RESET default_transaction_read_only').format(sql.Identifier(SOURCE['PGDATABASE'])))
        else:
            source.execute(sql.SQL('ALTER DATABASE {} SET default_transaction_read_only={}').format(sql.Identifier(SOURCE['PGDATABASE']),sql.Literal(prior)))
        for item in STATE['source_roles']:
            if item['rolname'] in ROLES:
                source.execute(sql.SQL('ALTER ROLE {} {}').format(sql.Identifier(item['rolname']),sql.SQL('LOGIN' if item['rolcanlogin'] else 'NOLOGIN')))


def bucket_client(env):
    return boto3.client('s3', endpoint_url=env['S3_ENDPOINT'],
        aws_access_key_id=env['S3_ACCESS_KEY'], aws_secret_access_key=env['S3_SECRET_KEY'],
        region_name=env.get('S3_REGION','auto'), config=Config(connect_timeout=10,read_timeout=30,
        retries={'max_attempts':2},s3={'addressing_style':env.get('S3_ADDRESSING_STYLE','virtual')}))


def inventory(client, bucket):
    objects = []
    for page in client.get_paginator('list_objects_v2').paginate(Bucket=bucket):
        for item in page.get('Contents', []):
            objects.append({'key':item['Key'],'bytes':item['Size'],'etag':item['ETag'],
                            'modified_at':item['LastModified'].isoformat()})
    return sorted(objects,key=lambda x:x['key'])


def copy_media(source, env):
    client, bucket = bucket_client(env), env['S3_BUCKET']
    objects = inventory(client,bucket)
    photos = source.execute('SELECT original_key,original_checksum,derivative_key,derivative_checksum FROM survey_photo').fetchall()
    expected = {}
    for item in photos:
        for key,checksum in [('original_key','original_checksum'),('derivative_key','derivative_checksum')]:
            if item[key]:
                expected[item[key]] = item[checksum]
    keys = {item['key'] for item in objects}
    if not expected.keys() <= keys or any(not x for x in expected.values()):
        raise RuntimeError('Source bucket does not contain every referenced file/checksum')
    stage = WORK / 'media'
    stage.mkdir(mode=0o700)
    total = 0
    for item in objects:
        key = item['key']
        parts = PurePosixPath(key).parts
        if not parts or key.startswith('/') or '..' in parts or '\\' in key:
            raise RuntimeError('Unsafe bucket key')
        path = stage.joinpath(*parts)
        path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        old = BASE / 'media' / key
        if key in expected and old.is_file() and digest(old) == expected[key]:
            shutil.copyfile(old,path)
        else:
            response = client.get_object(Bucket=bucket,Key=key,IfMatch=item['etag'])
            with response['Body'] as incoming, path.open('xb') as outgoing:
                shutil.copyfileobj(incoming,outgoing)
        checksum = digest(path)
        if path.stat().st_size != item['bytes'] or (key in expected and checksum != expected[key]):
            raise RuntimeError('Media content differs from the source/reference')
        path.chmod(0o600)
        item['sha256'] = checksum
        total += item['bytes']
    second = inventory(client,bucket)
    if second != [{k:v for k,v in item.items() if k != 'sha256'} for item in objects]:
        raise RuntimeError('Source bucket changed while copying')
    save(WORK / 'media-inventory.json',objects)
    archive = WORK / 'media.tar'
    with tarfile.open(archive,'w') as tar:
        tar.add(stage,arcname='media',recursive=True)
    archive.chmod(0o600)
    STATE['media'] = {'objects':len(objects),'bytes':total,'referenced_files':len(expected),
        'matching_referenced_checksums':len(expected),'archive_sha256':digest(archive)}
    emit('media_copied',**STATE['media'])


def env_text(values):
    lines = []
    for key,value in values.items():
        if any(c in value for c in ['\n','\r','\x00']):
            raise RuntimeError('Multiline environment value rejected')
        lines.append(key + '="' + value.replace('\\','\\\\').replace('"','\\"') + '"\n')
    return ''.join(lines)


def activate_config(envs):
    for name in ['admin','public','broker']:
        # Use existing env-file keys, with the running values, preserving recent settings.
        path = PRIVATE / (name + '.env')
        keys = [line.split('=',1)[0] for line in path.read_text().splitlines() if '=' in line and not line.startswith('#')]
        values = {key:envs[name][key] for key in keys}
        key = 'admin_password' if name == 'admin' else 'public_password'
        role = 'survey_admin_app' if name == 'admin' else 'survey_public_app'
        values.update(SURVEY_DATA_SOURCE='vps',SURVEY_MEDIA_ROOT=str(BASE / 'media'),
            DATABASE_URL='postgresql://' + role + ':' + quote(TARGET[key],safe='') + '@127.0.0.1:15433/surveey')
        for key in list(values):
            if key.startswith('S3_'):
                del values[key]
        atomic(path,env_text(values))
        unitpath = Path('/etc/systemd/system/surveey-' + name + '.service')
        content = unitpath.read_text().replace('using Railway data','using local VPS data')
        content = content.replace('After=network-online.target','After=network-online.target surveey-postgres.service\nRequires=surveey-postgres.service')
        content = content.replace('ConditionPathExists=' + str(PRIVATE / 'railway-db-endpoint.json'),
                                  'ConditionPathExists=' + str(BASE / 'FULL_VPS_CONFIGURED.json'))
        content = content.replace('InaccessiblePaths=', 'InaccessiblePaths=' + str(DATA) + ' ')
        if name in ['admin','broker']:
            content = content.replace('InaccessiblePaths=' + str(DATA) + ' ' + str(BASE / 'media') + ' ',
                                      'InaccessiblePaths=' + str(DATA) + ' ')
        if name == 'admin':
            content = content.replace('ReadWritePaths=/tmp','ReadWritePaths=/tmp ' + str(BASE / 'media'))
        if name == 'broker':
            content = content.replace('ReadWritePaths=/tmp','ReadWritePaths=/tmp\nReadOnlyPaths=' + str(BASE / 'media'))
        atomic(unitpath,content,0o644)
    edge = Path('/etc/systemd/system/surveey-edge.service')
    atomic(edge,edge.read_text().replace('using Railway data','using local VPS data').replace(
        'ConditionPathExists=' + str(PRIVATE / 'railway-db-endpoint.json'),
        'ConditionPathExists=' + str(BASE / 'FULL_VPS_CONFIGURED.json')),0o644)
    receiver = Path('/usr/local/libexec/surveey-release.py')
    old = "if not (BASE / 'HYBRID_CONFIGURED.json').is_file():\n        raise SystemExit('This receiver requires the existing Railway-data deployment.')"
    new = "if not any((BASE / marker).is_file() for marker in ('HYBRID_CONFIGURED.json', 'FULL_VPS_CONFIGURED.json')):\n        raise SystemExit('This receiver requires an explicitly configured data deployment.')"
    text = receiver.read_text()
    if old not in text:
        raise RuntimeError('Installed receiver differs from the expected guard')
    atomic(receiver,text.replace(old,new).replace('# Refuse alternate data modes and never configure, migrate or restore data.',
        '# Require explicit data configuration; never configure, migrate or restore data.'),0o755)
    owner = pwd.getpwnam('surveey')
    for directory, dirs, files in os.walk(WORK / 'media'):
        os.chown(directory,owner.pw_uid,owner.pw_gid)
        os.chmod(directory,0o700)
        for name in files:
            path = Path(directory) / name
            os.chown(path,owner.pw_uid,owner.pw_gid)
            path.chmod(0o600)
    previous = BASE / ('media-before-' + IDENTIFIER)
    if previous.exists():
        raise RuntimeError('Previous-media preservation path already exists')
    os.rename(BASE / 'media', previous)
    STATE['old_media_path'] = str(previous)
    os.rename(WORK / 'media', BASE / 'media')
    STATE['media_switched'] = True
    record = {'configured_at_utc':now(),'data_source':'vps','database_source':'VPS',
        'media_source':'VPS filesystem','migration_id':IDENTIFIER,'database':'surveey',
        'database_directory':str(DATA),'database_port':15433,'media_root':str(BASE / 'media'),
        'railway_data_retained':True,'railway_application_roles_fenced':True}
    save(BASE / 'FULL_VPS_CONFIGURED.json',record)
    (BASE / 'FULL_VPS_CONFIGURED.json').chmod(0o644)


def cutover():
    if STATE['phase'] != 'prepared' or str((BASE / 'current').resolve()) != STATE['release']:
        raise RuntimeError('Preparation/release changed; cutover refused')
    for item in STATE['configuration']:
        if item['path'].endswith('/surveey-postgres.service'):
            continue
        if digest(Path(item['path'])) != item['sha256']:
            raise RuntimeError('Configuration changed after preparation')
    if protected() != STATE['protected_before']:
        raise RuntimeError('Protected service state changed before cutover')
    envs = {name:live_env(name) for name in ['admin','public','broker']}
    opened, stopped, source = False, False, connect_source()
    try:
        stopped = True
        run(['systemctl','stop',*UNITS], 'pause-surveey-writers')
        fence(source)
        STATE['write_pause_at_utc'] = now()
        emit('source_writes_fenced',railway_data_retained=True)
        STATE['final_dump'] = export('final.dump')
        expected = fingerprint(source)
        save(WORK / 'source-integrity.json',expected)
        copy_media(source,envs['admin'])
        with connect_target() as target:
            target.execute('CREATE DATABASE surveey OWNER surveey_operator TEMPLATE template0 ENCODING \'UTF8\' LC_COLLATE \'en_US.utf8\' LC_CTYPE \'en_US.utf8\'')
        run([str(BIN / 'pg_restore'),'--no-owner','--exit-on-error','--dbname=surveey',str(WORK / 'final.dump')],
            'restore-final',pg_env())
        with connect_target('surveey') as target:
            actual = fingerprint(target)
            save(WORK / 'target-integrity.json',actual)
            if actual != expected:
                raise RuntimeError('Restored table/sequence/privilege fingerprints differ')
            target.execute('REVOKE CONNECT ON DATABASE surveey FROM PUBLIC')
            target.execute('GRANT CONNECT ON DATABASE surveey TO survey_admin_app,survey_public_app')
        STATE['integrity'] = {'all_tables_match':True,'tables':len(expected['tables']),
            'all_sequences_match':True,'sequences':len(expected['sequences']),
            'application_privileges_match':True,'rows':{k:v['rows'] for k,v in expected['tables'].items()}}
        save(WORK / 'state.json',STATE)
        emit('restore_matches_source',**STATE['integrity'])
        activate_config(envs)
        STATE['phase'] = 'configured_local'
        save(WORK / 'state.json',STATE)
        run(['systemctl','daemon-reload'],'cutover-daemon-reload')
        run(['systemctl','enable','surveey-postgres.service'],'enable-production-database')
        # Any failure from here must preserve newer VPS writes and repair forward.
        opened = True
        STATE['local_writes_opened_at_utc'] = now()
        save(WORK / 'state.json',STATE)
        run(['systemctl','start',*UNITS],'activate-surveey-local-data')
        STATE['activation_receipts'] = {unit:subprocess.check_output(['systemctl','show',unit,
            '--property=ActiveState,SubState,MainPID'],text=True) for unit in UNITS + ['surveey-postgres.service']}
        STATE['protected_after'] = protected()
        if STATE['protected_after'] != STATE['protected_before']:
            raise RuntimeError('Protected service state changed; investigate without automatic rollback')
        STATE['phase'] = 'activated'
        STATE['completed_at_utc'] = now()
        save(WORK / 'state.json',STATE)
        emit('activated',migration_id=IDENTIFIER,final_dump=STATE['final_dump'],
            integrity=STATE['integrity'],media=STATE['media'],
            protected_services_unchanged=True,railway_data_retained=True,railway_writes_fenced=True,
            activation_receipts=STATE['activation_receipts'])
    except Exception:
        STATE['phase'] = 'activation_needs_attention' if opened else 'failed_before_local_writes'
        save(WORK / 'state.json',STATE)
        if not opened:
            for item in STATE['configuration']:
                # Keep the prepared standalone target; production configuration reverts.
                if item['path'].endswith('/surveey-postgres.service'):
                    continue
                atomic(Path(item['path']),Path(item['backup']).read_text(),item['mode'])
            if STATE.get('media_switched'):
                os.rename(BASE / 'media',WORK / 'media-not-activated')
                os.rename(Path(STATE['old_media_path']),BASE / 'media')
            marker = BASE / 'FULL_VPS_CONFIGURED.json'
            if marker.exists():
                os.rename(marker,WORK / 'not-activated-FULL_VPS_CONFIGURED.json')
            if STATE.get('source_fenced'):
                unfreeze(source)
            if stopped:
                run(['systemctl','daemon-reload'],'rollback-daemon-reload')
                run(['systemctl','start',*UNITS],'resume-railway-data-applications')
            emit('old_production_resumed',target_preserved=True,railway_data_retained=True)
        raise
    finally:
        source.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('phase',choices=['prepare','finish-prepare','cutover'])
    parser.add_argument('--id',required=True)
    options = parser.parse_args()
    IDENTIFIER = options.id
    if os.geteuid() != 0 or not re.fullmatch(r'[0-9]{8}T[0-9]{6}Z',IDENTIFIER):
        raise SystemExit('Requires root and a timestamp migration identifier')
    os.umask(0o077)
    SOURCE = json.load(sys.stdin)
    if SOURCE.get('PGDATABASE') != 'railway':
        raise SystemExit('Unexpected source database')
    TARGET = json.loads((PRIVATE / 'target-secrets.json').read_text())
    WORK = PRIVATE / 'data-migrations' / IDENTIFIER
    if options.phase == 'prepare':
        WORK.mkdir(parents=True,mode=0o700)
        WORK.parent.chmod(0o700)
        STATE = {'migration_id':IDENTIFIER}
    else:
        STATE = json.loads((WORK / 'state.json').read_text())
    with (PRIVATE / 'autodeploy.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            {'prepare':prepare,'finish-prepare':finish_prepare,'cutover':cutover}[options.phase]()
        except Exception as error:
            emit('operation_failed',error_type=type(error).__name__,
                reason=str(error) if isinstance(error,RuntimeError) else 'Private diagnostic required',
                migration_id=IDENTIFIER)
            raise SystemExit(1)
