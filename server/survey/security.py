import hashlib
import time
from datetime import timedelta
from django.db import transaction
from django.utils import timezone
from django.http import JsonResponse, HttpResponseNotFound
from .models import RateBucket
from .domain import Problem
from .login_assets import login_assets

def permission(user, action):
    allowed = {'edit': {'editor', 'publisher', 'owner'}, 'publish': {'publisher', 'owner'}, 'accounts': {'owner'}}
    if not user.is_authenticated or not user.is_active or user.role not in allowed[action]:
        raise Problem('Akses tidak diizinkan.', 403)

def throttle(key, limit, seconds):
    digest = hashlib.sha256(key.encode()).hexdigest()
    now = timezone.now()
    with transaction.atomic():
        RateBucket.objects.get_or_create(key=digest, defaults={'window_start': now})
        row = RateBucket.objects.select_for_update().get(key=digest)
        if row.window_start <= now-timedelta(seconds=seconds):
            row.window_start, row.count = now, 0
        row.count += 1
        row.save()
        return row.count <= limit

def establish(request):
    request.session.cycle_key()
    request.session['started'] = int(time.time())
    request.session['last_seen'] = int(time.time())
    request.session['version'] = request.user.session_version

class AdminBoundary:
    def __init__(self, get_response):
        self.get_response = get_response
    def __call__(self, request):
        from django.contrib.auth import logout
        now = int(time.time())
        if request.user.is_authenticated:
            session = request.session
            if (not request.user.is_active or session.get('version') != request.user.session_version or
                now-session.get('started', 0) >= 28800 or now-session.get('last_seen', 0) >= 1800):
                logout(request)
            else:
                session['last_seen'] = now
        path = request.path
        response = None
        if path not in ('/', '/admin') and not path.startswith('/admin/'):
            response = HttpResponseNotFound()
        else:
            relative = path[len('/admin'):] if path.startswith('/admin/') else '/'
            if (relative not in ('/', '/login', '/logout') and not request.user.is_authenticated
                    and not (request.method == 'GET' and relative.startswith('/assets/')
                        and relative[len('/assets/'):] in login_assets()['names'])):
                response = JsonResponse({'error': 'Silakan masuk terlebih dahulu.'}, status=401)
            elif request.user.is_authenticated and relative.startswith('/api/'):
                limit = 30 if relative == '/api/photos' else 180
                if not throttle(f'api:{request.user.pk}', limit, 60):
                    response = JsonResponse({'error': 'Terlalu banyak permintaan. Coba sebentar lagi.'}, status=429)
        if response is None:
            response = self.get_response(request)
        response['Cache-Control'] = 'private, no-store'
        # Map imagery and the Figtree font come from the same hosts the public map uses.
        response['Content-Security-Policy'] = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https://mt1.google.com; connect-src 'self'; font-src 'self' https://fonts.gstatic.com; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
        response['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()'
        return response
