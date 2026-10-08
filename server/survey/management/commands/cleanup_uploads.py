from datetime import timedelta
from django.utils import timezone
from django.core.management.base import BaseCommand
from survey.models import Photo, Draft, ObservationEvidence, Revision
from delivery.models import PublishedMedia
from delivery import storage

class Command(BaseCommand):
    help = 'Delete unreferenced temporary uploads older than 24 hours. Dry-run unless --apply. Retains legacy evidence.'
    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true')
    def handle(self, **options):
        candidates = Photo.objects.filter(uploaded_by__isnull=False, created_at__lt=timezone.now()-timedelta(hours=24))
        protected = set(ObservationEvidence.objects.values_list('photo_id', flat=True)) | set(PublishedMedia.objects.values_list('id', flat=True))
        for row in Revision.objects.values_list('state', flat=True):
            if row.get('photo_id'):
                protected.add(__import__('uuid').UUID(row['photo_id']))
        for row in Draft.objects.filter(status='pending').values_list('proposed', flat=True):
            if row.get('state', {}).get('photo_id'):
                protected.add(__import__('uuid').UUID(row['state']['photo_id']))
        for photo in candidates:
            if photo.id not in protected:
                self.stdout.write(str(photo.id))
                if options['apply']:
                    storage.remove(photo.original_key)
                    if photo.derivative_key:
                        storage.remove(photo.derivative_key)
                    photo.delete()
