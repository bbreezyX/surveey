import json
import mimetypes
import re
import uuid
from functools import wraps
from pathlib import Path
from django.conf import settings
from django.contrib.auth import authenticate, login as django_login, logout as django_logout, update_session_auth_hash
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ObjectDoesNotExist, ValidationError
from django.db import connection, transaction, IntegrityError
from django.db.models import Count, Prefetch, Q
from django.db.models.expressions import RawSQL
from django.db.models.functions import Lower
from django.http import JsonResponse, HttpResponse, FileResponse, HttpResponseRedirect
from django.middleware.csrf import get_token
from django.shortcuts import render
from django.utils import timezone
from django.views.decorators.debug import sensitive_post_parameters
from django.views.decorators.http import require_http_methods
from delivery import storage
from delivery.models import ActivePublication, Publication, PublishedMedia
from .domain import Problem, text, identifier, counts, nomor_gaps, nomor_prefix, parse_coordinate_query, matches_search_query
from .models import Account, Point, Draft, Revision, Observation, ObservationEvidence, Photo, AuditEvent
from .security import permission, establish, throttle
from .media import store_photo, MAX_BYTES
from .login_assets import login_assets
from . import services
from delivery.media_cache import open_cached

# Kepmendagri region tree for Jambi, shared with the address picker.
WILAYAH = (Path(__file__).resolve().parent / 'data' / 'wilayah-jambi.json').read_bytes()
REGIONS = {entry['nama'].removeprefix('Kabupaten ').upper(): entry['nama'] for entry in json.loads(WILAYAH)}
REGION_ALIASES = {'MUARO BUNGO': 'BUNGO'}

def response(value, status=200):
    return JsonResponse(value, status=status, json_dumps_params={'ensure_ascii': False})

def api(methods):
    def decorate(fn):
        @wraps(fn)
        @require_http_methods(methods)
        def wrapped(request, *args, **kwargs):
            try:
                if not request.user.is_authenticated:
                    raise Problem('Silakan masuk terlebih dahulu.', 401)
                permission(request.user, 'edit')
                return fn(request, *args, **kwargs)
            except Problem as error:
                return response({'error': error.message, 'details': error.details}, error.status)
            except ObjectDoesNotExist:
                return response({'error': 'Data tidak ditemukan.'}, 404)
            except IntegrityError:
                return response({'error': 'Data bertentangan dengan perubahan lain. Muat ulang.'}, 409)
        return wrapped
    return decorate

def body(request, keys):
    if request.content_type != 'application/json':
        raise Problem('Gunakan application/json.', 415)
    try:
        def invalid_constant(value):
            raise ValueError(value)
        value = json.loads(request.body, parse_constant=invalid_constant)
    except (ValueError, UnicodeDecodeError):
        raise Problem('Isi permintaan tidak valid.')
    if not isinstance(value, dict) or set(value) != set(keys):
        raise Problem('Kolom permintaan tidak sesuai.')
    return value

def csrf_failure(request, reason=''):
    return response({'error': 'Sesi keamanan tidak cocok. Muat ulang halaman dan coba kembali.'}, 403)

def login_page(request, error=None, status=200):
    return render(request, 'login.html', {'csrf': get_token(request), 'error': error, 'assets': login_assets()}, status=status)

def account_view(account):
    return {'id': account.pk, 'username': account.username, 'name': account.first_name,
        'role': account.role, 'enabled': account.is_active, 'last_login': account.last_login.isoformat() if account.last_login else None}

@require_http_methods(['GET'])
def home(request):
    if not request.user.is_authenticated:
        return login_page(request)
    path = settings.ADMIN_BUILD / 'index.html'
    if not path.is_file():
        return response({'error': 'Build admin belum tersedia. Jalankan npm run build:admin.'}, 503)
    return FileResponse(path.open('rb'), content_type='text/html; charset=utf-8')

@sensitive_post_parameters('password')
@require_http_methods(['POST'])
def login(request):
    username = request.POST.get('username', '').strip()[:150]
    password = request.POST.get('password', '')
    ip = request.META.get('REMOTE_ADDR', '')  # Never trust client-supplied forwarding headers.
    ip_allowed = throttle(f'login-ip:{ip}', 30, 900)
    account_allowed = throttle(f'login-account:{username.lower()}', 10, 900)
    if not ip_allowed or not account_allowed:
        return login_page(request, 'Terlalu banyak percobaan. Coba lagi setelah 15 menit.', 429)
    user = authenticate(request, username=username, password=password) if len(password) <= 1024 else None
    if user is None or not user.is_active:
        services.audit(None, 'login.failed', 'authentication')
        return login_page(request, 'Nama akun atau kata sandi salah.', 401)
    django_login(request, user)
    establish(request)
    services.audit(user, 'login.succeeded', user.pk)
    return HttpResponseRedirect('/admin/')

@require_http_methods(['POST'])
def logout(request):
    if request.user.is_authenticated:
        services.audit(request.user, 'session.logout', request.user.pk)
    django_logout(request)
    return HttpResponseRedirect('/admin/')

@api(['GET'])
def session(request):
    return response({'account': account_view(request.user), 'csrf': get_token(request), 'idle_seconds': 1800, 'absolute_seconds': 28800})


def point_summary(request):
    # One request-local snapshot supplies counts, numbering gaps and backdrop.
    # Never cache editable point data across requests or across accounts.
    if not hasattr(request, '_point_summary'):
        request._point_summary = list(Point.objects.values('id', 'nomor', 'state', 'archived'))
    return request._point_summary


def filtered_points(request, *, for_export=False):
    query = request.GET.get('q', '')[:250].strip()
    rows = Point.objects.all()
    region = request.GET.get('region', '')
    if region:
        if region not in REGIONS:
            raise Problem('Kabupaten/kota tidak dikenal.')
        matches = Q(nomor__istartswith=region + '-')
        for alias, canonical in REGION_ALIASES.items():
            if canonical == region:
                matches |= Q(nomor__istartswith=alias + '-')
        rows = rows.filter(matches)
    if query:
        parsed_coord = parse_coordinate_query(query)
        matched_ids = [
            p['id'] for p in point_summary(request)
            if matches_search_query(p['nomor'], p['state'], query, parsed_coord)
        ]
        rows = rows.filter(pk__in=matched_ids)
    raw_nomors = request.GET.get('nomors', '')
    if raw_nomors and not for_export:
        wanted_nomors = [item.strip()[:250] for item in raw_nomors.split(',') if item.strip()][:200]
        if wanted_nomors:
            rows = rows.filter(nomor__in=wanted_nomors)
    status = request.GET.get('status', '')
    # The official allocation: what the overview counts and what the Excel export holds.
    if for_export or status == 'resmi':
        return rows.filter(archived=False).exclude(state__status='Cadangan')
    if status == 'pasti':
        return rows.filter(archived=False, state__status='', state__duplikat=False)
    if status == 'drafts':
        # Include archived points that have pending activation drafts so the filter matches the Drafts queue.
        return rows.filter(draft__status='pending').distinct()
    if status in ('Cadangan', 'Belum Ditetapkan'):
        rows = rows.filter(state__status=status)
    elif status == 'duplikat':
        rows = rows.filter(state__duplikat=True)
    elif status == 'tanpa_foto':
        # JSONField `isnull=True` checks missing keys rather than JSON `null`; match against the summary snapshot instead.
        rows = rows.filter(pk__in=[p['id'] for p in point_summary(request) if not p['state'].get('photo_id')])
    elif status == 'urut':
        # Points in any desa whose active unit numbers are not 001..N, using the
        # same request-local summary that supplies the overview count and badges.
        summary = point_summary(request)
        gap_prefixes = set(nomor_gaps(p['nomor'] for p in summary if not p['archived']))
        rows = rows.filter(pk__in=[p['id'] for p in summary if p['nomor'].rpartition('-')[0].upper() in gap_prefixes])
    if request.GET.get('archived') != '1':
        rows = rows.filter(archived=False)
    return rows


def point_list_payload(request):
    rows = filtered_points(request)
    try:
        page = max(1, int(request.GET.get('page', 1)))
    except ValueError:
        raise Problem('Nomor halaman tidak valid.')
    total = rows.count()
    pages = max(1, (total + 49) // 50)
    page = min(page, pages)
    rows = rows.annotate(drafts=Count('draft', filter=Q(draft__status='pending'))).order_by(Lower('nomor'), 'nomor')[(page-1)*50:page*50]
    summary = point_summary(request)
    pending_drafts = Draft.objects.filter(status='pending').count()
    missing_photo = sum(
        1 for p in summary
        if not p['archived'] and p['state'].get('status') != 'Cadangan' and not p['state'].get('photo_id')
    )
    return {'items': [{'id': str(p.pk), 'revision': p.revision, 'state': p.state, 'drafts': p.drafts} for p in rows],
        'total': total, 'page': page, 'pages': pages, 'counts': counts(p['state'] for p in summary),
        'pending_drafts': pending_drafts, 'missing_photo': missing_photo,
        'gaps': nomor_gaps(p['nomor'] for p in summary if not p['archived'])}


def map_items(rows):
    items = []
    for pk, state in rows:
        lon, lat = state.get('lon'), state.get('lat')
        if isinstance(lon, (int, float)) and isinstance(lat, (int, float)) and abs(lon) <= 180 and abs(lat) <= 90:
            items.append({'id': str(pk), 'nomor': state.get('nomor') or '', 'lon': lon, 'lat': lat,
                'status': state.get('status') or '', 'duplikat': bool(state.get('duplikat'))})
    return items


@api(['GET'])
def bootstrap(request):
    # Initial dashboard data crosses authentication/session middleware once.
    points = point_list_payload(request)
    return response({'account': account_view(request.user), 'csrf': get_token(request),
        'idle_seconds': 1800, 'absolute_seconds': 28800, 'points': points,
        'regions': [{'value': key, 'label': label} for key, label in sorted(REGIONS.items(), key=lambda entry: entry[1])],
        'map': {'items': map_items((p['id'], p['state']) for p in point_summary(request) if not p['archived'])}})


@api(['GET', 'POST'])
def points(request):
    if request.method == 'POST':
        data = body(request, ['state', 'reason'])
        point = services.create_point(request.user, data['state'], data['reason'])
        return response({'id': str(point.pk), 'revision': point.revision}, 201)
    return response(point_list_payload(request))

@api(['GET'])
def next_nomor(request):
    # Fills the new-point form's Nomor once a desa is picked. null when the
    # address is not in the picker's official form.
    prefix = nomor_prefix(request.GET.get('alamat', '')[:3000])
    return response({'nomor': services.next_nomor(prefix, services.taken_nomors(prefix)) if prefix else None})

@api(['POST'])
def renumber(request):
    data = body(request, ['prefix', 'reason'])
    renumbered, publication = services.renumber(request.user, data['prefix'], data['reason'])
    return response({'renumbered': renumbered, 'id': str(publication.id)}, 201)

@api(['GET'])
def point_map(request):
    # Every active point's position and status in one response, for the
    # dashboard's map backdrop; the list endpoint pages at 50.
    return response({'items': map_items(Point.objects.filter(archived=False).values_list('pk', 'state'))})

@api(['GET'])
def wilayah(request):
    return HttpResponse(WILAYAH, content_type='application/json')

@api(['GET'])
def point_detail(request, point_id):
    point = Point.objects.annotate(pending_drafts=Count('draft', filter=Q(draft__status='pending'))).get(pk=point_id)
    observations = []
    photo_ids = set()
    if point.state.get('photo_id'):
        photo_ids.add(point.state['photo_id'])
    rows = Observation.objects.filter(point=point).select_related('author').order_by('-created_at').prefetch_related(
        Prefetch('observationevidence_set', queryset=ObservationEvidence.objects.only('observation_id', 'photo_id')))
    for obs in rows:
        obs_photos = [str(v.photo_id) for v in obs.observationevidence_set.all()]
        photo_ids.update(obs_photos)
        observations.append({'id': str(obs.pk), 'date': obs.date, 'lon': float(obs.longitude), 'lat': float(obs.latitude),
            'notes': obs.notes, 'source': obs.source, 'author': obs.author.username if obs.author else None,
            'at': obs.created_at.isoformat(), 'photos': obs_photos})
    revisions = [{'number': r.number, 'state': r.state, 'reason': r.reason,
        'actor': r.actor.username if r.actor else None,
        'at': r.created_at.isoformat()} for r in Revision.objects.filter(point=point).select_related('actor').order_by('-number')]
    media_rows = list(PublishedMedia.objects.filter(id__in=photo_ids).values_list('id', 'revoked')) if photo_ids else []
    published_photos = [str(mid) for mid, revoked in media_rows if not revoked]
    revoked_photos = [str(mid) for mid, revoked in media_rows if revoked]
    # The editor opens on the viewer's own pending draft, so a saved change is
    # still in the form the next time the point is opened.
    own = Draft.objects.filter(point=point, author=request.user, status='pending').order_by('-created_at').first()
    return response({'id': str(point.pk), 'revision': point.revision, 'state': point.state,
        'drafts': point.pending_drafts, 'published_photos': published_photos, 'revoked_photos': revoked_photos,
        'own_draft': {'id': str(own.id), 'base_revision': own.base_revision, 'proposed': own.proposed, 'reason': own.reason} if own else None,
        'observations': observations, 'revisions': revisions})

@api(['GET', 'POST'])
def drafts(request):
    if request.method == 'POST':
        data = body(request, ['point_id', 'base_revision', 'proposed', 'reason'])
        draft = services.save_draft(
            request.user, data['point_id'], data['base_revision'], data['proposed'], data['reason'])
        return response(services.draft_preview(draft, request.user), 201)
    rows = Draft.objects.filter(status='pending').select_related('point', 'author').order_by('-created_at')
    return response({'items': [services.draft_preview(d, request.user) for d in rows]})

@api(['POST'])
def discard(request, draft_id):
    body(request, [])
    services.discard_draft(request.user, draft_id)
    return response({'ok': True})

@api(['POST'])
def restore(request, point_id):
    data = body(request, ['revision', 'base_revision', 'reason'])
    if type(data['revision']) is not int or type(data['base_revision']) is not int:
        raise Problem('Nomor revisi tidak valid.')
    draft = services.restore_draft(request.user, point_id, **data)
    return response(services.draft_preview(draft, request.user), 201)

@api(['POST'])
def publish_point(request, point_id):
    data = body(request, ['base_revision', 'proposed', 'reason'])
    point, publication = services.publish_point(
        request.user, point_id, data['base_revision'], data['proposed'], data['reason'])
    return response({'id': str(point.pk), 'revision': point.revision, 'publication_id': str(publication.id)}, 201)

@api(['POST'])
def publish(request):
    data = body(request, ['draft_ids', 'reason'])
    publication = services.publish(request.user, data['draft_ids'], data['reason'])
    return response({'id': str(publication.id), 'created_at': publication.created_at.isoformat()}, 201)

@api(['GET'])
def publications(request):
    # Count features inside the database instead of transferring up to 100 full GeoJSON snapshots into Python.
    count_sql = (
        "COALESCE(jsonb_array_length(geojson->'features'), 0)"
        if connection.vendor == 'postgresql'
        else "COALESCE(json_array_length(geojson, '$.features'), 0)"
    )
    rows = list(
        Publication.objects.defer('geojson', 'manifest')
        .annotate(point_count=RawSQL(count_sql, ()))
        .order_by('-created_at')[:100]
    )
    pub_ids = [str(p.id) for p in rows]
    events = {}
    if pub_ids:
        for event in AuditEvent.objects.filter(action='publication.activated', target__in=pub_ids).select_related('actor'):
            events[event.target] = event
    return response({'active_id': str(ActivePublication.objects.get(id=1).publication_id or ''),
        'items': [{
            'id': str(p.id), 'at': p.created_at.isoformat(), 'checksum': p.checksum, 'points': int(p.point_count),
            'actor': events[str(p.id)].actor.username if str(p.id) in events and events[str(p.id)].actor else None,
            'reason': events[str(p.id)].reason if str(p.id) in events else '',
        } for p in rows]})

@api(['POST'])
def baseline(request):
    data = body(request, ['reason'])
    publication = services.publish_baseline(request.user, data['reason'])
    return response({'id': str(publication.id)}, 201)

@api(['POST'])
def photos(request):
    if request.content_type != 'multipart/form-data':
        raise Problem('Unggah foto sebagai multipart/form-data.', 415)
    uploaded = request.FILES.get('file')
    if not uploaded:
        raise Problem('Pilih berkas foto terlebih dahulu.', 400)
    if uploaded.size > MAX_BYTES:
        raise Problem('Foto maksimum 20 MiB.', 413)
    point = Point.objects.get(pk=identifier(request.POST.get('point_id')))
    raw = bytearray()
    for chunk in uploaded.chunks():
        raw.extend(chunk)
        if len(raw) > MAX_BYTES:
            raise Problem('Foto maksimum 20 MiB.', 413)
    photo = store_photo(bytes(raw), uploaded.name, request.user, point, uploaded.content_type)
    services.audit(request.user, 'photo.uploaded', photo.pk, after={'point_id': str(point.id), 'checksum': photo.original_checksum})
    return response({'id': str(photo.id), 'url': f'/admin/api/photos/{photo.id}/display', 'width': photo.width, 'height': photo.height}, 201)

@api(['GET'])
def photo_content(request, photo_id, kind):
    if kind not in ('display', 'original'):
        raise Problem('Data tidak ditemukan.', 404)
    photo = Photo.objects.get(pk=photo_id)
    if photo.point_id is None:
        permission(request.user, 'publish')
    if kind == 'display' and not photo.ready:
        raise Problem('Foto belum siap.', 404)
    key = photo.derivative_key if kind == 'display' else photo.original_key
    content_type = photo.mime if kind == 'display' else 'application/octet-stream'
    # Authentication, permission and current photo metadata are checked before
    # touching this private derivative cache. Originals remain streamed from storage.
    try:
        stream = open_cached(getattr(settings, 'ADMIN_MEDIA_CACHE_ROOT', None), photo.derivative_checksum,
            lambda: storage.get(key)) if kind == 'display' else storage.get(key)
    except FileNotFoundError:
        raise Problem('Berkas foto tidak ditemukan.', 404)
    except (TimeoutError, ConnectionError):
        raise Problem('Penyimpanan foto sedang tidak tersedia.', 503)
    result = FileResponse(stream, content_type=content_type, as_attachment=kind == 'original', filename=f'{photo.id}.bin' if kind == 'original' else None)
    result['X-Content-Type-Options'] = 'nosniff'
    return result

@api(['POST'])
def revoke(request, photo_id):
    data = body(request, ['reason'])
    detached = services.revoke_photo(request.user, photo_id, data['reason'])
    return response({'ok': True, 'detached_points': detached})

@api(['GET', 'POST'])
@sensitive_post_parameters('password')
def accounts(request):
    permission(request.user, 'accounts')
    if request.method == 'GET':
        return response({'items': [account_view(a) for a in Account.objects.order_by('username')]})
    data = body(request, ['username', 'name', 'role', 'password'])
    username = text(data['username'], 'Nama akun', 150, True)
    if not re.fullmatch(r'[\w.@+-]+', username):
        raise Problem('Nama akun menggunakan huruf, angka, titik, @, +, -, atau garis bawah.')
    if Account.objects.filter(username__iexact=username).exists():
        raise Problem('Nama akun sudah digunakan.', 409)
    if data['role'] not in ('editor', 'publisher', 'owner'):
        raise Problem('Peran tidak dikenal.')
    account = Account(username=username, first_name=text(data['name'], 'Nama', 150), role=data['role'])
    set_password(account, data['password'])
    with transaction.atomic():
        account.save()
        services.audit(request.user, 'account.created', account.pk, after=account_view(account))
    return response(account_view(account), 201)

def set_password(account, password):
    if not isinstance(password, str) or len(password) > 1024:
        raise Problem('Kata sandi tidak valid.')
    try:
        validate_password(password, account)
    except ValidationError as error:
        raise Problem(' '.join(error.messages))
    account.set_password(password)

@api(['PATCH'])
@sensitive_post_parameters('password')
def account_update(request, account_id):
    permission(request.user, 'accounts')
    data = body(request, ['enabled', 'role', 'password', 'reason'])
    reason = text(data['reason'], 'Alasan perubahan akses', 3000, True)
    if type(data['enabled']) is not bool or data['role'] not in ('editor', 'publisher', 'owner'):
        raise Problem('Peran atau status akun tidak valid.')
    with transaction.atomic():
        # Serialize all account changes to prevent concurrent removal of the last owner.
        ActivePublication.objects.select_for_update().get(id=1)
        account = Account.objects.select_for_update().get(pk=account_id)
        if data['enabled'] == account.is_active and data['role'] == account.role and not data['password']:
            raise Problem('Tidak ada perubahan pada akun ini.')
        before = account_view(account)
        if account.is_active and account.role == 'owner' and (not data['enabled'] or data['role'] != 'owner'):
            if Account.objects.filter(is_active=True, role='owner').count() <= 1:
                raise Problem('Pemilik terakhir tidak dapat dinonaktifkan atau diturunkan perannya.', 409)
        account.is_active, account.role = data['enabled'], data['role']
        if data['password']:
            set_password(account, data['password'])
        account.session_version += 1
        account.save()
        services.audit(request.user, 'account.changed', account.pk, before, account_view(account), reason)
    # Keep the owner's own current browser session alive when editing themselves (while still revoking other sessions).
    if account.pk == request.user.pk and account.is_active:
        request.user = account
        if data['password']:
            update_session_auth_hash(request, account)
        establish(request)
    return response(account_view(account))

@api(['POST'])
@sensitive_post_parameters('old_password', 'password')
def password(request):
    data = body(request, ['old_password', 'password'])
    if not throttle(f'password:{request.user.pk}', 10, 900):
        raise Problem('Terlalu banyak percobaan. Coba setelah 15 menit.', 429)
    with transaction.atomic():
        user = Account.objects.select_for_update().get(pk=request.user.pk)
        if not isinstance(data['old_password'], str) or len(data['old_password']) > 1024 or not user.check_password(data['old_password']):
            raise Problem('Kata sandi lama tidak sesuai.', 403)
        set_password(user, data['password'])
        user.session_version += 1
        user.save()
        services.audit(user, 'account.password_changed', user.pk)
    request.user = user
    update_session_auth_hash(request, user)
    establish(request)
    return response({'ok': True})

def resolve_audit_targets(rows):
    uuids, int_ids = set(), set()
    for row in rows:
        raw = row.target or ''
        if raw.isdigit():
            int_ids.add(int(raw))
        else:
            try:
                uuids.add(uuid.UUID(raw))
            except ValueError:
                pass
    labels = {}
    if int_ids:
        for pk, username in Account.objects.filter(pk__in=int_ids).values_list('pk', 'username'):
            labels[str(pk)] = username
    if uuids:
        for pk, nomor in Point.objects.filter(id__in=uuids).values_list('id', 'nomor'):
            labels[str(pk)] = nomor
        missing = uuids - {uuid.UUID(k) for k in labels if not k.isdigit()}
        if missing:
            for pk, nomor in Draft.objects.filter(id__in=missing).values_list('id', 'point__nomor'):
                labels[str(pk)] = nomor
        missing = uuids - {uuid.UUID(k) for k in labels if not k.isdigit()}
        if missing:
            for pk, nomor, legacy_name in Photo.objects.filter(id__in=missing).values_list('id', 'point__nomor', 'legacy_name'):
                labels[str(pk)] = nomor or legacy_name or str(pk)
    return labels

@api(['GET'])
def audit_history(request):
    permission(request.user, 'publish')
    events = AuditEvent.objects.select_related('actor')
    action = request.GET.get('action', '')[:60].strip()
    if action:
        events = events.filter(action=action)
    query = request.GET.get('q', '')[:250].strip()
    if query:
        matched_targets = (
            [str(pk) for pk in Point.objects.filter(nomor__icontains=query).values_list('id', flat=True)[:200]]
            + [str(pk) for pk in Draft.objects.filter(point__nomor__icontains=query).values_list('id', flat=True)[:200]]
            + [str(pk) for pk in Account.objects.filter(username__icontains=query).values_list('pk', flat=True)[:50]]
        )
        cond = Q(reason__icontains=query) | Q(target__icontains=query) | Q(actor__username__icontains=query)
        if matched_targets:
            cond |= Q(target__in=matched_targets)
        events = events.filter(cond)
    rows = list(events.order_by('-id')[:200])
    labels = resolve_audit_targets(rows)
    return response({'items': [{'id': e.pk, 'actor': e.actor.username if e.actor else 'Operator/import',
        'action': e.action, 'target': e.target, 'target_label': labels.get(e.target, e.target),
        'before': e.before, 'after': e.after,
        'reason': e.reason, 'at': e.created_at.isoformat()} for e in rows]})

@api(['GET'])
def export(request):
    permission(request.user, 'publish')
    active = ActivePublication.objects.select_related('publication').get(id=1)
    if not active.publication_id:
        raise Problem('Belum ada data terbit.', 404)
    result = response(active.publication.geojson)
    result['Content-Disposition'] = 'attachment; filename="points.geojson"'
    return result

@api(['GET'])
def export_csv(request):
    import csv
    import io
    permission(request.user, 'publish')
    active = ActivePublication.objects.select_related('publication').get(id=1)
    if not active.publication_id:
        raise Problem('Belum ada data terbit.', 404)
    fields = ['Nomor', 'Nama Anggota', 'Jalur', 'Alamat', 'Keterangan', 'Lokasi Rekapan', 'Catatan',
        'Status', 'Duplikat', 'Tanggal Dokumentasi', 'Longitude', 'Latitude', 'Foto Survey Awal']
    output = io.StringIO(newline='')
    writer = csv.writer(output)
    writer.writerow(fields)
    for feature in active.publication.geojson['features']:
        values = []
        for field in fields:
            value = feature['properties'].get(field, '')
            if isinstance(value, str) and value.lstrip().startswith(('=', '+', '-', '@')):
                value = "'" + value  # Prevent spreadsheet formula execution from user-entered text.
            values.append(value)
        writer.writerow(values)
    result = HttpResponse('\ufeff' + output.getvalue(), content_type='text/csv; charset=utf-8')
    result['Content-Disposition'] = 'attachment; filename="points.csv"'
    return result

@api(['GET'])
def export_xlsx(request):
    from .point_export import point_workbook

    permission(request.user, 'publish')
    rows = filtered_points(request, for_export=True).order_by('nomor').values('id', 'nomor', 'state')
    output = point_workbook(rows, REGIONS, REGION_ALIASES)
    # A name a person can read in Downloads: what, which area, which search, when.
    # The ISO date sorts exports by day. The search keeps only characters every
    # filesystem accepts and ASCII, so the header stays a plain filename="…".
    parts = ['Titik Survei PUTS 2026', REGIONS.get(request.GET.get('region', ''), 'Semua Kabupaten-Kota')]
    search = ' '.join(re.sub(r'[^A-Za-z0-9 .-]', ' ', request.GET.get('q', '')).split())[:40].strip(' .-')
    if search:
        parts.append(f'Cari {search}')
    parts.append(f'{timezone.localdate():%Y-%m-%d}')
    return FileResponse(output, as_attachment=True, filename=' - '.join(parts) + '.xlsx',
        content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

@api(['GET'])
def legacy_evidence(request):
    permission(request.user, 'publish')
    return response({'items': [{'id': str(photo.id), 'name': photo.legacy_name, 'ready': photo.ready,
        'checksum': photo.original_checksum} for photo in Photo.objects.filter(point__isnull=True).order_by('legacy_name')]})

@require_http_methods(['GET'])
def asset(request, filename):
    # Boundary middleware admits authenticated users, plus anonymous requests for the
    # login page's own files (login_assets). No generic filesystem path route.
    if '/' in filename or '\\' in filename or not __import__('re').fullmatch(r'[\w.-]+\.(js|css|woff2|png|svg|json)', filename):
        return HttpResponse(status=404)
    path = settings.ADMIN_BUILD / 'assets' / filename
    if not path.is_file():
        return HttpResponse(status=404)
    return FileResponse(path.open('rb'), content_type=mimetypes.guess_type(path.name)[0] or 'application/octet-stream')
