"""Draft a Nomor rename for every point whose address puts it in another desa.

One-off batch (2026-10-10). Nomor now follows the address on every saved
draft (services.assign_nomor), but points published before that change keep
Nomor that disagree with their address: kecamatan split since the Nomor was
written (Kota Baru -> Alam Barajo), "MUARO BUNGO" for Kabupaten Bungo,
spelling fixes (Bandar -> Bendar Sedap), and points moved to another desa in
the admin (Tempino -> Pelempang). This drafts the same state through
save_draft, which assigns the new Nomor; the drafts are then reviewed and
published like any edit.

Only addresses in the official form are read, and spelling or case alone is
not a move (services.same_place). Points with a pending draft are skipped.
Without --apply everything runs inside a transaction that is rolled back, so
the printed Nomor are exactly the ones --apply would draft.
"""
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from survey.domain import nomor_prefix, same_place
from survey.models import Account, Draft, Point
from survey.services import save_draft

REASON = 'Menyesuaikan Nomor dengan desa, kecamatan dan kabupaten pada alamat.'

class Command(BaseCommand):
    help = 'Draft Nomor renames that follow each point\'s address. Dry-run unless --apply.'
    def add_arguments(self, parser):
        parser.add_argument('--actor', required=True, help='Account recorded as the drafts\' author.')
        parser.add_argument('--apply', action='store_true')
    def handle(self, **options):
        actor = Account.objects.filter(username=options['actor'], is_active=True).first()
        if not actor:
            raise CommandError('--actor must be an active account.')
        pending = set(Draft.objects.filter(status='pending').values_list('point_id', flat=True))
        drafted = skipped = 0
        with transaction.atomic():
            for point in Point.objects.order_by('nomor'):
                prefix = nomor_prefix(point.state['alamat'])
                if not prefix or same_place(point.nomor, prefix):
                    continue
                if point.id in pending:
                    skipped += 1
                    self.stdout.write(f'skip (pending draft) {point.nomor}')
                    continue
                draft = save_draft(actor, str(point.id), point.revision, {'state': dict(point.state), 'new_observation': None}, REASON)
                self.stdout.write(f'{point.nomor} -> {draft.proposed["state"]["nomor"]}')
                drafted += 1
            if not options['apply']:
                transaction.set_rollback(True)
        self.stdout.write(f'{"Drafted" if options["apply"] else "Would draft"} {drafted}, skipped {skipped} with a pending draft.')
