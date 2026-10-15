import time
from concurrent.futures import ThreadPoolExecutor
from django.conf import settings
from django.core.management.base import BaseCommand
from delivery.models import ActivePublication, PublishedMedia
from delivery.views import open_media

# A push redeploys admin (the media broker) alongside public-data, so the first pass
# can hit the broker while it is being replaced. Retry what failed a few times.
ROUNDS = 5
ROUND_DELAY_SECONDS = 30


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
        pending = records
        for round_number in range(ROUNDS):
            if round_number:
                time.sleep(ROUND_DELAY_SECONDS)
            # Two fetches at a time: the broker has two workers and visitors' misses share them.
            with ThreadPoolExecutor(max_workers=2) as pool:
                pending = [record for record, ok in zip(pending, pool.map(warm, pending)) if not ok]
            if not pending:
                break
        self.stdout.write(f'Media cache: {len(records) - len(pending)}/{len(records)} ready.')
        self.stdout.flush()
