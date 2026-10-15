from concurrent.futures import ThreadPoolExecutor
from django.conf import settings
from django.core.management.base import BaseCommand
from delivery.models import ActivePublication, PublishedMedia
from delivery.views import open_media


def warm(record):
    try:
        open_media(record).close()
        return True
    except (FileNotFoundError, TimeoutError, ConnectionError, OSError):
        return False


class Command(BaseCommand):
    help = 'Copy every photo of the active publication into the local media cache.'

    def handle(self, *args, **options):
        if not settings.MEDIA_CACHE_ROOT:
            return
        active = ActivePublication.objects.filter(id=1).values_list('publication_id', flat=True).first()
        records = list(PublishedMedia.objects.filter(revoked=False, retain_until__isnull=True,
            mediagrant__publication_id=active).distinct())
        # Two fetches at a time: the broker has two workers and visitors' misses share them.
        with ThreadPoolExecutor(max_workers=2) as pool:
            warmed = sum(pool.map(warm, records))
        self.stdout.write(f'Media cache: {warmed}/{len(records)} ready.')
