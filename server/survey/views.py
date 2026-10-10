import json
import mimetypes
from functools import wraps
from pathlib import Path
from django.conf import settings
from django.contrib.auth import authenticate, login as django_login, logout as django_logout, update_session_auth_hash
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ObjectDoesNotExist, ValidationError
from django.db import transaction, IntegrityError
from django.http import JsonResponse, HttpResponse, FileResponse, HttpResponseRedirect
from django.middleware.csrf import get_token
from django.shortcuts import render
from django.views.decorators.debug import sensitive_post_parameters
from django.views.decorators.http import require_http_methods
from delivery import storage
from delivery.models import ActivePublication, Publication
from .domain import Problem, text, identifier, counts
from .models import Account, Point, Draft, Revision, Observation, ObservationEvidence, Photo, AuditEvent
from .security import permission, establish, throttle
from .media import store_photo, MAX_BYTES
from .login_assets import login_assets
from . import services

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
        return login_page(request, 'Nama akun atau kata sandi tidak sesuai.', 401)
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

@api(['GET', 'POST'])
def points(request):
    if request.method == 'POST':
        data = body(request, ['state', 'reason'])
        point = services.create_point(request.user, data['state'], data['reason'])
        return response({'id': str(point.pk), 'revision': point.revision}, 201)
    from django.db.models import Q
    query = request.GET.get('q', '')[:250].strip()
    rows = Point.objects.all()
    if query:
        rows = rows.filter(Q(nomor__icontains=query) | Q(state__alamat__icontains=query) |
            Q(state__nama__icontains=query) | Q(state__keterangan__icontains=query) | Q(state__jalur__icontains=query) | Q(state__status__icontains=query))
    status = request.GET.get('status', '')
    if status in ('Cadangan', 'Belum Ditetapkan'):
        rows = rows.filter(state__status=status)
    elif status == 'duplikat':
        rows = rows.filter(state__duplikat=True)
    if request.GET.get('archived') != '1':
        rows = rows.filter(archived=False)
    try:
        page = max(1, int(request.GET.get('page', 1)))
    except ValueError:
        raise Problem('Nomor halaman tidak valid.')
    total = rows.count()
    rows = rows.order_by('nomor')[(page-1)*50:page*50]
    return response({'items': [{'id': str(p.pk), 'revision': p.revision, 'state': p.state} for p in rows],
        'total': total, 'page': page, 'pages': max(1, (total+49)//50), 'counts': counts(Point.objects.values_list('state', flat=True))})

@api(['GET'])
def point_map(request):
    # Every active point's position and status in one response, for the
    # dashboard's map backdrop; the list endpoint pages at 50.
    items = []
    for pk, state in Point.objects.filter(archived=False).values_list('pk', 'state'):
        lon, lat = state.get('lon'), state.get('lat')
        if isinstance(lon, (int, float)) and isinstance(lat, (int, float)) and abs(lon) <= 180 and abs(lat) <= 90:
            items.append({'id': str(pk), 'lon': lon, 'lat': lat, 'status': state.get('status') or '', 'duplikat': bool(state.get('duplikat'))})
    return response({'items': items})

# Kepmendagri region tree for Jambi (kab/kota → kecamatan → desa/kel), built
# by scripts/build_wilayah_jambi.py. Served from our own origin because the
# admin's CSP keeps connect-src at 'self'; read once, it never changes at runtime.
WILAYAH = (Path(__file__).resolve().parent / 'data' / 'wilayah-jambi.json').read_bytes()

@api(['GET'])
def wilayah(request):
    return HttpResponse(WILAYAH, content_type='application/json')

@api(['GET'])
def point_detail(request, point_id):
    point = Point.objects.get(pk=point_id)
    observations = []
    for obs in Observation.objects.filter(point=point).order_by('-created_at'):
        observations.append({'id': str(obs.pk), 'date': obs.date, 'lon': float(obs.longitude), 'lat': float(obs.latitude),
            'notes': obs.notes, 'source': obs.source, 'photos': [str(v) for v in ObservationEvidence.objects.filter(observation=obs).values_list('photo_id', flat=True)]})
    revisions = [{'number': r.number, 'state': r.state, 'reason': r.reason,
        'at': r.created_at.isoformat()} for r in Revision.objects.filter(point=point).order_by('-number')]
    return response({'id': str(point.pk), 'revision': point.revision, 'state': point.state,
        'observations': observations, 'revisions': revisions})

@api(['GET', 'POST'])
def drafts(request):
    if request.method == 'POST':
        data = body(request, ['point_id', 'base_revision', 'proposed', 'reason'])
        draft = services.save_draft(
            request.user, data['point_id'], data['base_revision'], data['proposed'], data['reason'])
        return response(services.draft_preview(draft), 201)
    rows = Draft.objects.filter(status='pending').select_related('point', 'author').order_by('-created_at')
    return response({'items': [services.draft_preview(d) for d in rows]})

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
    return response(services.draft_preview(draft), 201)

@api(['POST'])
def publish(request):
    data = body(request, ['draft_ids', 'reason'])
    publication = services.publish(request.user, data['draft_ids'], data['reason'])
    return response({'id': str(publication.id), 'created_at': publication.created_at.isoformat()}, 201)

@api(['GET'])
def publications(request):
    return response({'active_id': str(ActivePublication.objects.get(id=1).publication_id or ''),
        'items': [{'id': str(p.id), 'at': p.created_at.isoformat(), 'checksum': p.checksum,
            'points': len(p.geojson['features'])} for p in Publication.objects.order_by('-created_at')[:100]]})

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
    if not uploaded or uploaded.size > MAX_BYTES:
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
    if kind == 'display' and not photo.ready:
        raise Problem('Foto belum siap.', 404)
    key = photo.derivative_key if kind == 'display' else photo.original_key
    content_type = photo.mime if kind == 'display' else 'application/octet-stream'
    result = FileResponse(storage.get(key), content_type=content_type, as_attachment=kind == 'original', filename=f'{photo.id}.bin' if kind == 'original' else None)
    result['X-Content-Type-Options'] = 'nosniff'
    return result

@api(['POST'])
def revoke(request, photo_id):
    data = body(request, ['reason'])
    services.revoke_photo(request.user, photo_id, data['reason'])
    return response({'ok': True})

@api(['GET', 'POST'])
@sensitive_post_parameters('password')
def accounts(request):
    permission(request.user, 'accounts')
    if request.method == 'GET':
        return response({'items': [account_view(a) for a in Account.objects.order_by('username')]})
    data = body(request, ['username', 'name', 'role', 'password'])
    username = text(data['username'], 'Nama akun', 150, True)
    if not __import__('re').fullmatch(r'[\w.@+-]+', username):
        raise Problem('Nama akun menggunakan huruf, angka, titik, @, +, -, atau garis bawah.')
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

@api(['GET'])
def audit_history(request):
    permission(request.user, 'publish')
    return response({'items': [{'id': e.pk, 'actor': e.actor.username if e.actor else 'Operator/import',
        'action': e.action, 'target': e.target, 'before': e.before, 'after': e.after,
        'reason': e.reason, 'at': e.created_at.isoformat()} for e in AuditEvent.objects.select_related('actor').order_by('-id')[:200]]})

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
