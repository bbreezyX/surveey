import hashlib
import json
from datetime import timedelta
from django.db import transaction, IntegrityError
from django.utils import timezone
from delivery.models import Publication, ActivePublication, PublishedMedia, MediaGrant
from delivery import storage
from .models import Point, Draft, Photo, Observation, ObservationEvidence, Revision, AuditEvent
from .domain import Problem, validate_state, text, date, coordinate, identifier, clone, public_feature, counts, movement
from .security import permission

def audit(actor, action, target, before=None, after=None, reason=''):
    return AuditEvent.objects.create(actor=actor, action=action, target=str(target), before=before, after=after, reason=reason)

def checked_photo(photo_id, point):
    if not photo_id:
        return None
    photo = Photo.objects.filter(id=identifier(photo_id), point=point, ready=True).first()
    if not photo:
        raise Problem('Foto tidak tersedia untuk titik ini.')
    return photo

def validate_proposal(point, proposed):
    if not isinstance(proposed, dict) or set(proposed) != {'state', 'new_observation'}:
        raise Problem('Usulan perubahan tidak valid.')
    state = validate_state(proposed['state'], point.state)
    photo = checked_photo(state['photo_id'], point)
    if photo and photo.id != point.state.get('photo_id') and not photo.ready:
        raise Problem('Foto belum siap.')
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

@transaction.atomic
def save_draft(actor, point_id, base_revision, proposed, reason):
    permission(actor, 'edit')
    point = Point.objects.select_for_update().get(id=identifier(point_id))
    if type(base_revision) is not int or point.revision != base_revision:
        raise Problem('Titik telah berubah. Muat ulang dan bandingkan perubahan sebelum menyimpan.', 409,
            {'revision': point.revision, 'state': point.state})
    proposed = validate_proposal(point, proposed)
    reason = text(reason, 'Alasan perubahan', 3000, True)
    # One pending draft per author and point: the editor reopens it, and saving
    # again revises it instead of stacking near-identical drafts for review.
    draft = Draft.objects.select_for_update().filter(point=point, author=actor, status='pending').order_by('-created_at').first()
    if draft:
        draft.base_revision, draft.proposed, draft.reason = base_revision, proposed, reason
        draft.save(update_fields=['base_revision', 'proposed', 'reason'])
        audit(actor, 'draft.updated', draft.id, point.state, proposed, reason)
        return draft
    draft = Draft.objects.create(point=point, base_revision=base_revision, proposed=proposed, reason=reason, author=actor)
    audit(actor, 'draft.created', draft.id, point.state, proposed, reason)
    return draft

@transaction.atomic
def create_point(actor, state, reason):
    permission(actor, 'edit')
    state = validate_state(state)
    if state['photo_id'] or state['observation_id']:
        raise Problem('Titik baru harus dibuat sebelum menambahkan bukti survei.')
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

def draft_preview(draft):
    point = draft.point
    before, after = point.state, draft.proposed['state']
    return {'id': str(draft.id), 'point_id': str(point.id), 'nomor': point.nomor,
        'base_revision': draft.base_revision, 'current_revision': point.revision, 'status': draft.status,
        'before': before, 'after': after, 'new_observation': draft.proposed['new_observation'],
        'reason': draft.reason, 'author': draft.author.username, 'created_at': draft.created_at.isoformat(),
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
    if point.revision != base_revision:
        raise Problem('Titik telah berubah. Muat ulang sebelum memulihkan.', 409)
    checked_photo(state['photo_id'], point)
    reason = text(reason, 'Alasan pemulihan', 3000, True)
    draft = Draft.objects.create(point=point, base_revision=base_revision,
        proposed={'state': state, 'new_observation': None, 'restore_revision': previous.number}, reason=reason, author=actor)
    audit(actor, 'draft.restore', draft.id, point.state, state, reason)
    return draft

def validate_saved_draft(draft):
    if 'restore_revision' in draft.proposed:
        previous = Revision.objects.get(point=draft.point, number=draft.proposed['restore_revision'])
        if previous.state != draft.proposed['state'] or draft.proposed.get('new_observation') is not None:
            raise Problem('Draf pemulihan tidak sesuai riwayat.')
        state = validate_state(previous.state, draft.point.state)
        checked_photo(state['photo_id'], draft.point)
        return {'state': state, 'new_observation': None}
    return validate_proposal(draft.point, draft.proposed)

@transaction.atomic
def publish(actor, draft_ids, reason):
    permission(actor, 'publish')
    reason = text(reason, 'Catatan penerbitan', 3000, True)
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
        state, obs = proposal['state'], proposal['new_observation']
        if obs:
            observation = Observation.objects.create(point=point, date=obs['date'], longitude=state['lon'],
                latitude=state['lat'], notes=obs['notes'], source=obs['source'], author=draft.author)
            state['observation_id'] = str(observation.id)
        elif state['observation_id']:
            observation = Observation.objects.get(id=state['observation_id'], point=point)
        else:
            observation = None
        if observation and state['photo_id']:
            ObservationEvidence.objects.get_or_create(observation=observation, photo_id=state['photo_id'])
        before = point.state
        point.revision += 1
        point.state, point.archived = state, state['archived']
        point.save(update_fields=['revision', 'state', 'archived', 'updated_at'])
        Revision.objects.create(point=point, number=point.revision, state=state, actor=actor, reason=draft.reason)
        draft.status = 'published'
        draft.save(update_fields=['status'])
        audit(actor, 'point.published', point.id, before, state, draft.reason)
    return build_publication(actor, active, reason)

def build_publication(actor, active, reason):
    points = list(Point.objects.filter(archived=False).order_by('nomor'))
    photo_ids = {p.state['photo_id'] for p in points if p.state['photo_id']}
    photos = list(Photo.objects.filter(id__in=photo_ids, ready=True))
    if len(photos) != len(photo_ids):
        raise Problem('Terdapat foto yang belum siap. Penerbitan dibatalkan.', 409)
    known = {media.id: media for media in PublishedMedia.objects.filter(id__in=[photo.id for photo in photos])}
    if any(media.revoked for media in known.values()):
        raise Problem('Foto telah dicabut karena privasi; pilih foto lain.', 409)
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
    # Same publication lock prevents a concurrent publication from reapproving revoked media.
    ActivePublication.objects.select_for_update().get(id=1)
    media = PublishedMedia.objects.select_for_update().get(id=identifier(photo_id))
    media.revoked = True
    media.save(update_fields=['revoked'])
    audit(actor, 'media.revoked', media.id, reason=text(reason, 'Alasan privasi', 3000, True))
