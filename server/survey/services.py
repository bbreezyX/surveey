import hashlib
import json
import logging
import re
import threading
import time
import urllib.request
from datetime import timedelta
from django.conf import settings
from django.db import transaction, IntegrityError
from django.utils import timezone
from delivery.models import Publication, ActivePublication, PublishedMedia, MediaGrant
from delivery import storage
from .models import Point, Draft, Photo, Observation, ObservationEvidence, Revision, AuditEvent
from .domain import Problem, validate_state, nomor_prefix, nomor_gaps, same_place, text, date, coordinate, identifier, clone, public_feature, counts, movement
from .security import permission

logger = logging.getLogger(__name__)


def notify_esdm_sync(publication_id, checksum, reason='', *, retries=2, sleep=time.sleep):
    """Best-effort POST to esdm.cloud after a publication commits.

    Runs on a background thread so a slow or restarting ESDM server never
    blocks or fails Surveey publishing. Retries briefly for transient blips.
    """
    url = getattr(settings, 'ESDM_SYNC_URL', '')
    token = getattr(settings, 'ESDM_SYNC_TOKEN', '')
    if not url or not token:
        return False
    timeout = getattr(settings, 'ESDM_SYNC_TIMEOUT', 10)
    payload = json.dumps({
        'trigger': 'surveey-publish',
        'publication': str(publication_id),
        'checksum': checksum,
        'reason': reason,
    }).encode()
    headers = {
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json',
        'User-Agent': 'surveey-publish-sync/1',
    }
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, data=payload, headers=headers, method='POST')
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                if 200 <= resp.status < 300:
                    return True
                logger.warning('ESDM sync returned HTTP %s (attempt %s)', resp.status, attempt + 1)
        except Exception as exc:
            logger.warning('ESDM sync failed (attempt %s): %s', attempt + 1, exc)
        if attempt < retries:
            sleep(2 * (attempt + 1))
    return False


def schedule_esdm_sync(publication_id, checksum, reason=''):
    url = getattr(settings, 'ESDM_SYNC_URL', '')
    token = getattr(settings, 'ESDM_SYNC_TOKEN', '')
    if not url or not token or getattr(settings, 'TESTING', False):
        return
    threading.Thread(
        target=notify_esdm_sync,
        args=(publication_id, checksum, reason),
        name='esdm-sync',
        daemon=True,
    ).start()

def audit(actor, action, target, before=None, after=None, reason=''):
    return AuditEvent.objects.create(actor=actor, action=action, target=str(target), before=before, after=after, reason=reason)

def checked_photo(photo_id, point):
    if not photo_id:
        return None
    photo = Photo.objects.filter(id=identifier(photo_id), point=point, ready=True).first()
    if not photo:
        raise Problem('Foto tidak tersedia untuk titik ini.')
    if PublishedMedia.objects.filter(id=photo.id, revoked=True).exists():
        raise Problem('Foto telah dicabut karena privasi dan tidak dapat digunakan kembali.')
    return photo

def assign_nomor(point, state, wanted=None):
    """Rename the point when its address moves it to another desa.

    The number is the next free one in that desa, counting other points and
    other points' pending drafts, so no two points can publish the same
    Nomor. A draft saved again keeps the number it already holds."""
    prefix = nomor_prefix(state['alamat'])
    if not prefix or same_place(point.nomor, prefix):
        state['nomor'] = point.nomor
        return state
    taken = taken_nomors(prefix, point)
    if isinstance(wanted, str):
        normalized = wanted.strip().upper()
        if re.fullmatch(re.escape(prefix) + r'-\d{3,}', normalized) and normalized not in taken:
            state['nomor'] = normalized
            return state
    state['nomor'] = next_nomor(prefix, taken)
    return state

def taken_nomors(prefix, point=None):
    # Other points' numbers in the desa plus those other points' pending
    # drafts have reserved there (upper-cased), so no two can publish the same Nomor.
    points = Point.objects.filter(nomor__istartswith=prefix + '-')
    drafts = Draft.objects.filter(status='pending', proposed__state__nomor__istartswith=prefix + '-')
    if point:
        points, drafts = points.exclude(pk=point.pk), drafts.exclude(point=point)
    return {n.upper() for n in points.values_list('nomor', flat=True)} | {d.proposed['state']['nomor'].upper() for d in drafts}

def next_nomor(prefix, taken):
    numbers = [int(n.rsplit('-', 1)[1]) for n in taken if re.fullmatch(re.escape(prefix) + r'-\d+', n)]
    return f'{prefix}-{max(numbers, default=0) + 1:03d}'

def validate_proposal(point, proposed):
    if not isinstance(proposed, dict) or set(proposed) != {'state', 'new_observation'} or not isinstance(proposed['state'], dict):
        raise Problem('Usulan perubahan tidak valid.')
    # The Nomor is never taken from the form; it is derived from the address.
    wanted = proposed['state'].get('nomor')
    state = validate_state({**proposed['state'], 'nomor': point.nomor} if 'nomor' in proposed['state'] else proposed['state'], point.state)
    assign_nomor(point, state, wanted)
    photo = checked_photo(state['photo_id'], point)
    obs = proposed['new_observation']
    if obs is not None:
        if not isinstance(obs, dict) or set(obs) != {'date', 'notes', 'source'}:
            raise Problem('Pengamatan baru tidak valid.')
        obs = {'date': date(obs['date']), 'notes': text(obs['notes'], 'Catatan survei', 6000),
            'source': text(obs['source'], 'Sumber survei', 3000, True)}
        if not photo or str(photo.id) == point.state['photo_id']:
            raise Problem('Kunjungan survei baru memerlukan foto bukti baru; unggah foto kunjungan tersebut.')
        state['date'] = obs['date']
        state['observation_id'] = None
    else:
        # A correction preserves the observation identity/date. Previous evidence stays immutable.
        if state['observation_id'] != point.state['observation_id'] or state['date'] != point.state['date']:
            raise Problem('Koreksi tidak mengubah tanggal atau pengamatan; pilih survei baru untuk kunjungan baru.')
    return {'state': state, 'new_observation': obs}

def has_proposal_changes(before, proposal):
    return proposal['new_observation'] is not None or proposal['state'] != before

def format_distance_id(metres):
    return f'{round(metres)} m' if metres < 1000 else f'{metres / 1000:.2f} km'.replace('.', ',')


def default_change_reason(before, after, new_observation=None):
    parts = []
    if before['lat'] != after['lat'] or before['lon'] != after['lon']:
        dist = movement(before, after)
        parts.append(f'Geser koordinat {format_distance_id(dist)}' if dist >= 1 else 'Koreksi koordinat')
    if before['archived'] != after['archived']:
        parts.append('Arsipkan titik' if after['archived'] else 'Aktifkan titik')
    if before['status'] != after['status']:
        parts.append(f"Ubah status ({after['status'] or 'Alokasi utama'})")
    if before['duplikat'] != after['duplikat']:
        parts.append('Tandai perlu verifikasi' if after['duplikat'] else 'Selesai verifikasi lokasi')
    if before['nomor'] != after['nomor']:
        parts.append(f"Pindah desa ({after['nomor']})")
    elif before['alamat'] != after['alamat']:
        parts.append('Ubah alamat')
    if before['photo_id'] != after['photo_id']:
        parts.append('Ganti foto survei' if after['photo_id'] else 'Hapus foto survei')
    if new_observation:
        parts.append('Kunjungan survei baru')
    if any(before[k] != after[k] for k in ('nama', 'jalur', 'keterangan', 'lokasi_rekapan', 'catatan')):
        parts.append('Koreksi data titik')
    return ' · '.join(parts)[:3000] or 'Pembaruan data titik'


def apply_point_proposal(actor, author, point, proposal, reason):
    state, obs = proposal['state'], proposal['new_observation']
    if obs:
        observation = Observation.objects.create(point=point, date=obs['date'], longitude=state['lon'],
            latitude=state['lat'], notes=obs['notes'], source=obs['source'], author=author)
        state['observation_id'] = str(observation.id)
    elif state['observation_id']:
        observation = Observation.objects.get(id=state['observation_id'], point=point)
    else:
        observation = None
    if observation and state['photo_id']:
        ObservationEvidence.objects.get_or_create(observation=observation, photo_id=state['photo_id'])
    before = point.state
    point.revision += 1
    point.state, point.archived, point.nomor = state, state['archived'], state['nomor']
    point.save(update_fields=['revision', 'state', 'archived', 'nomor', 'updated_at'])
    Revision.objects.create(point=point, number=point.revision, state=state, actor=actor, reason=reason)
    audit(actor, 'point.published', point.id, before, state, reason)
    return point


@transaction.atomic
def save_draft(actor, point_id, base_revision, proposed, reason):
    permission(actor, 'edit')
    point = Point.objects.select_for_update().get(id=identifier(point_id))
    if type(base_revision) is not int or point.revision != base_revision:
        raise Problem('Titik telah berubah. Muat ulang dan bandingkan perubahan sebelum menyimpan.', 409,
            {'revision': point.revision, 'state': point.state})
    before = point.state
    proposed = validate_proposal(point, proposed)
    if not has_proposal_changes(before, proposed):
        raise Problem('Tidak ada perubahan untuk disimpan.')
    reason = text(reason, 'Alasan perubahan', 3000) or default_change_reason(
        before, proposed['state'], proposed['new_observation'])
    # One pending draft per author and point: the editor reopens it, and saving
    # again revises it instead of stacking near-identical drafts for review.
    draft = Draft.objects.select_for_update().filter(point=point, author=actor, status='pending').order_by('-created_at').first()
    if draft:
        draft.base_revision, draft.proposed, draft.reason = base_revision, proposed, reason
        draft.save(update_fields=['base_revision', 'proposed', 'reason'])
        audit(actor, 'draft.updated', draft.id, before, proposed, reason)
        return draft
    draft = Draft.objects.create(point=point, base_revision=base_revision, proposed=proposed, reason=reason, author=actor)
    audit(actor, 'draft.created', draft.id, before, proposed, reason)
    return draft


@transaction.atomic
def publish_point(actor, point_id, base_revision, proposed, reason):
    permission(actor, 'publish')
    # Same lock order as publish() (ActivePublication -> Draft -> Point) to prevent deadlocks.
    active = ActivePublication.objects.select_for_update().get(id=1)
    point_uuid = identifier(point_id)
    own_drafts = list(Draft.objects.select_for_update().filter(point_id=point_uuid, author=actor, status='pending').order_by('-created_at'))
    point = Point.objects.select_for_update().get(id=point_uuid)
    if type(base_revision) is not int or point.revision != base_revision:
        raise Problem('Titik telah berubah. Muat ulang dan bandingkan perubahan sebelum menerbitkan.', 409,
            {'revision': point.revision, 'state': point.state})
    before = point.state
    proposal = validate_proposal(point, proposed)
    if not has_proposal_changes(before, proposal):
        raise Problem('Tidak ada perubahan untuk diterbitkan.')
    clean_reason = text(reason, 'Alasan perubahan', 3000) or default_change_reason(
        before, proposal['state'], proposal['new_observation'])
    apply_point_proposal(actor, actor, point, proposal, clean_reason)
    if own_drafts:
        latest = own_drafts[0]
        latest.base_revision, latest.proposed, latest.reason, latest.status = base_revision, proposal, clean_reason, 'published'
        latest.save(update_fields=['base_revision', 'proposed', 'reason', 'status'])
        for extra in own_drafts[1:]:
            extra.status = 'discarded'
            extra.save(update_fields=['status'])
    return point, build_publication(actor, active, clean_reason)

@transaction.atomic
def create_point(actor, state, reason):
    permission(actor, 'edit')
    state = validate_state(state)
    if state['photo_id'] or state['observation_id']:
        raise Problem('Titik baru harus dibuat sebelum menambahkan bukti survei.')
    if Point.objects.filter(nomor__iexact=state['nomor']).exists():
        raise Problem('Nomor titik sudah digunakan.', 409)
    if Draft.objects.filter(status='pending', proposed__state__nomor__iexact=state['nomor']).exists():
        raise Problem('Nomor titik sedang dipesan oleh draf yang menunggu penerbitan.', 409)
    state['archived'] = True
    state['date'] = ''
    reason = text(reason, 'Alasan penambahan', 3000, True)
    try:
        point = Point.objects.create(nomor=state['nomor'], state=state, archived=True)
    except IntegrityError:
        raise Problem('Nomor titik sudah digunakan.', 409)
    Revision.objects.create(point=point, number=1, state=state, actor=actor, reason=reason)
    audit(actor, 'point.created', point.id, after=state, reason=reason)
    return point

def draft_preview(draft, actor=None):
    point = draft.point
    before, after = point.state, draft.proposed['state']
    return {'id': str(draft.id), 'point_id': str(point.id), 'nomor': point.nomor,
        'base_revision': draft.base_revision, 'current_revision': point.revision, 'status': draft.status,
        'before': before, 'after': after, 'new_observation': draft.proposed['new_observation'],
        'restore_revision': draft.proposed.get('restore_revision'),
        'reason': draft.reason, 'author': draft.author.username, 'created_at': draft.created_at.isoformat(),
        'can_discard': bool(actor and (actor.pk == draft.author_id or actor.role in ('publisher', 'owner'))),
        'movement_m': movement(before, after), 'counts_before': counts([before]), 'counts_after': counts([after])}

@transaction.atomic
def discard_draft(actor, draft_id):
    draft = Draft.objects.select_for_update().get(id=identifier(draft_id))
    if actor.pk != draft.author_id:
        permission(actor, 'publish')
    if draft.status != 'pending':
        raise Problem('Draf tidak lagi menunggu penerbitan.', 409)
    draft.status = 'discarded'
    draft.save(update_fields=['status'])
    audit(actor, 'draft.discarded', draft.id, reason=draft.reason)

@transaction.atomic
def restore_draft(actor, point_id, revision, base_revision, reason):
    permission(actor, 'edit')
    point = Point.objects.select_for_update().get(id=identifier(point_id))
    previous = Revision.objects.get(point=point, number=revision)
    state = clone(previous.state)
    # Restoring an earlier survey restores its existing observation without fabricating a visit.
    if type(base_revision) is not int or point.revision != base_revision:
        raise Problem('Titik telah berubah. Muat ulang sebelum memulihkan.', 409,
            {'revision': point.revision, 'state': point.state})
    if previous.number == point.revision or state == point.state:
        raise Problem('Titik sudah berada pada data revisi tersebut.')
    checked_photo(state['photo_id'], point)
    reason = text(reason, 'Alasan pemulihan', 3000, True)
    proposed = {'state': state, 'new_observation': None, 'restore_revision': previous.number}
    # Keep the same one-pending-draft-per-author invariant as save_draft.
    draft = Draft.objects.select_for_update().filter(point=point, author=actor, status='pending').order_by('-created_at').first()
    if draft:
        draft.base_revision, draft.proposed, draft.reason = base_revision, proposed, reason
        draft.save(update_fields=['base_revision', 'proposed', 'reason'])
    else:
        draft = Draft.objects.create(point=point, base_revision=base_revision, proposed=proposed, reason=reason, author=actor)
    audit(actor, 'draft.restore', draft.id, point.state, state, reason)
    return draft

def validate_saved_draft(draft):
    if 'restore_revision' in draft.proposed:
        previous = Revision.objects.get(point=draft.point, number=draft.proposed['restore_revision'])
        if previous.state != draft.proposed['state'] or draft.proposed.get('new_observation') is not None:
            raise Problem('Draf pemulihan tidak sesuai riwayat.')
        state = validate_state({**previous.state, 'nomor': draft.point.nomor}, draft.point.state)
        assign_nomor(draft.point, state, previous.state['nomor'])
        checked_photo(state['photo_id'], draft.point)
        return {'state': state, 'new_observation': None}
    return validate_proposal(draft.point, draft.proposed)

@transaction.atomic
def publish(actor, draft_ids, reason):
    permission(actor, 'publish')
    reason = text(reason, 'Catatan penerbitan', 3000)
    if not isinstance(draft_ids, list) or not 1 <= len(draft_ids) <= 100 or len(set(draft_ids)) != len(draft_ids):
        raise Problem('Pilih 1–100 draf yang berbeda.')
    ids = [identifier(v) for v in draft_ids]
    # Every publication shares this lock. It serializes competing publishers and active-pointer changes.
    active = ActivePublication.objects.select_for_update().get(id=1)
    drafts = list(Draft.objects.select_for_update().select_related('author').filter(id__in=ids).order_by('point_id'))
    if len(drafts) != len(ids) or any(d.status != 'pending' for d in drafts):
        raise Problem('Draf tidak tersedia atau telah diterbitkan.', 409)
    if len({d.point_id for d in drafts}) != len(drafts):
        raise Problem('Hanya satu draf per titik boleh diterbitkan dalam satu penerbitan.')
    points = {p.pk: p for p in Point.objects.select_for_update().filter(id__in=[d.point_id for d in drafts]).order_by('pk')}
    for draft in drafts:
        point = points[draft.point_id]
        draft.point = point
        if point.revision != draft.base_revision:
            raise Problem(f'{point.nomor} telah berubah; draf harus ditinjau ulang.', 409,
                {'point_id': str(point.id), 'revision': point.revision})
        proposal = validate_saved_draft(draft)
        apply_point_proposal(actor, draft.author, point, proposal, draft.reason)
        draft.status = 'published'
        draft.save(update_fields=['status'])
    pub_reason = reason or (drafts[0].reason if len(drafts) == 1 else f'Penerbitan {len(drafts)} draf')
    return build_publication(actor, active, pub_reason)

@transaction.atomic
def renumber(actor, prefix, reason):
    """Re-sequence one desa's units to 001..N, keeping their current order.

    Run by hand from the list, never on publish: it changes the Nomor of points
    nobody edited, which field lists and SK attachments may still cite. It
    publishes straight away so the public map and the admin agree on Nomor."""
    permission(actor, 'publish')
    prefix = text(prefix, 'Desa', 250, True).upper()
    # Tidying is mechanical, so the list sends no reason; the audit still names what was done.
    reason = text(reason, 'Alasan penomoran ulang', 3000) or f'Rapikan nomor unit {prefix}'
    active = ActivePublication.objects.select_for_update().get(id=1)
    points = [p for p in Point.objects.select_for_update().filter(nomor__istartswith=prefix + '-').order_by('pk')
        if re.fullmatch(re.escape(prefix) + r'-\d+', p.nomor.upper())]
    if prefix not in nomor_gaps([p.nomor for p in points if not p.archived]):
        raise Problem('Desa ini tidak memiliki nomor yang perlu dirapikan.', 409)
    # A pending draft here would become a conflict, and one moving a point in
    # holds a number assign_nomor reserved; both must be settled first.
    for draft in Draft.objects.filter(status='pending').select_related('point'):
        if any(nomor.upper().startswith(prefix + '-') for nomor in (draft.point.nomor, draft.proposed['state']['nomor'])):
            raise Problem('Selesaikan draf di desa ini terlebih dahulu.', 409)
    # Active units take 001..N in their current order; archived ones follow,
    # keeping a unique number so they can still be restored later.
    ordered = sorted(points, key=lambda p: (p.archived, int(p.nomor.rsplit('-', 1)[1]), p.nomor))
    # Each point keeps its own prefix spelling; only the number changes.
    changes = [(p, f"{p.nomor.rsplit('-', 1)[0]}-{i:03d}") for i, p in enumerate(ordered, 1)]
    changes = [(p, nomor) for p, nomor in changes if p.nomor != nomor]
    # Park the moving points on their own id first so no step of the shuffle
    # collides with the unique Nomor of a point still waiting to move.
    for point, _ in changes:
        Point.objects.filter(pk=point.pk).update(nomor=str(point.pk))
    for point, nomor in changes:
        before = point.state
        point.revision += 1
        point.state, point.nomor = dict(before, nomor=nomor), nomor
        point.save(update_fields=['revision', 'state', 'nomor', 'updated_at'])
        Revision.objects.create(point=point, number=point.revision, state=point.state, actor=actor, reason=reason)
        audit(actor, 'point.renumbered', point.id, before, point.state, reason)
    return len(changes), build_publication(actor, active, reason)

def build_publication(actor, active, reason):
    points = list(Point.objects.filter(archived=False).order_by('nomor'))
    photo_ids = {p.state['photo_id'] for p in points if p.state['photo_id']}
    photos = list(Photo.objects.filter(id__in=photo_ids, ready=True))
    ready_ids = {str(photo.id) for photo in photos}
    if len(photos) != len(photo_ids):
        missing = [p.nomor for p in points if p.state['photo_id'] and p.state['photo_id'] not in ready_ids]
        raise Problem(f"Terdapat foto yang belum siap ({', '.join(missing[:3])}). Penerbitan dibatalkan.", 409)
    known = {media.id: media for media in PublishedMedia.objects.filter(id__in=[photo.id for photo in photos])}
    revoked_ids = {str(mid) for mid, media in known.items() if media.revoked}
    if revoked_ids:
        affected = [p.nomor for p in points if p.state['photo_id'] in revoked_ids]
        raise Problem(f"Foto telah dicabut karena privasi ({', '.join(affected[:3])}); pilih foto lain.", 409)
    # Derivatives are write-once and cleanup_uploads never deletes anything with a PublishedMedia row,
    # so only photos published for the first time need a storage round trip. Re-checking every
    # manifest photo cost one HEAD per published point on each publication.
    for photo in photos:
        if photo.id not in known and not storage.exists(photo.derivative_key):
            raise Problem('Berkas foto belum tersedia. Penerbitan dibatalkan.', 409)
    geojson = {'type': 'FeatureCollection', 'features': [public_feature(p, p.state) for p in points]}
    manifest = sorted(str(photo.id) for photo in photos)
    checksum = hashlib.sha256(json.dumps(geojson, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
    publication = Publication.objects.create(geojson=geojson, manifest=manifest, checksum=checksum)
    # Retention begins when an image last leaves the active manifest, not when first uploaded.
    PublishedMedia.objects.filter(retain_until__isnull=True).exclude(id__in=photo_ids).update(retain_until=timezone.now()+timedelta(days=30))
    # Set-based writes keep the query count flat as the map grows; the publication lock above
    # serializes publishers, so the known/new split cannot race another publication.
    PublishedMedia.objects.filter(id__in=list(known), retain_until__isnull=False).update(retain_until=None)
    PublishedMedia.objects.bulk_create([PublishedMedia(id=photo.id, derivative_key=photo.derivative_key,
        checksum=photo.derivative_checksum, mime=photo.mime) for photo in photos if photo.id not in known])
    MediaGrant.objects.bulk_create([MediaGrant(publication=publication, media_id=photo.id) for photo in photos])
    previous = str(active.publication_id) if active.publication_id else None
    active.publication = publication
    active.save(update_fields=['publication'])
    audit(actor, 'publication.activated', publication.id, {'publication': previous},
        {'publication': str(publication.id), 'checksum': checksum, 'counts': counts([p.state for p in points])}, reason)
    transaction.on_commit(
        lambda pub_id=str(publication.id), pub_checksum=checksum, pub_reason=reason:
            schedule_esdm_sync(pub_id, pub_checksum, pub_reason)
    )
    return publication

@transaction.atomic
def publish_baseline(actor, reason):
    permission(actor, 'publish')
    active = ActivePublication.objects.select_for_update().get(id=1)
    if active.publication_id:
        raise Problem('Baseline hanya dapat diterbitkan sebelum penerbitan pertama.', 409)
    return build_publication(actor, active, text(reason, 'Alasan', 3000, True))

@transaction.atomic
def revoke_photo(actor, photo_id, reason):
    permission(actor, 'accounts')
    clean_reason = text(reason, 'Alasan privasi', 3000, True)
    # Same publication lock prevents a concurrent publication from reapproving revoked media.
    active = ActivePublication.objects.select_for_update().get(id=1)
    media = PublishedMedia.objects.select_for_update().get(id=identifier(photo_id))
    if media.revoked:
        raise Problem('Akses publik foto ini sudah dicabut sebelumnya.', 409)
    media.revoked = True
    media.save(update_fields=['revoked'])
    audit(actor, 'media.revoked', media.id, reason=clean_reason)
    # Detach the revoked photo from any point currently referencing it so public GeoJSON
    # drops the dead URL immediately and unrelated publications are not blocked by 409.
    affected = list(Point.objects.select_for_update().filter(state__photo_id=str(media.id)).order_by('pk'))
    point_reason = f'Cabut akses publik foto: {clean_reason}'[:3000]
    for point in affected:
        before = point.state
        after = {**before, 'photo_id': None}
        point.revision += 1
        point.state = after
        point.save(update_fields=['revision', 'state', 'updated_at'])
        Revision.objects.create(point=point, number=point.revision, state=after, actor=actor, reason=point_reason)
        audit(actor, 'point.published', point.id, before, after, point_reason)
    if any(not point.archived for point in affected) and active.publication_id:
        build_publication(actor, active, point_reason)
    return len(affected)
