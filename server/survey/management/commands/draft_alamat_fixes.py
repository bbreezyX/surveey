"""Draft official addresses for the imported points the region picker cannot read.

One-off batch (2026-10-10). Of the 550 imported addresses, 88 do not match the
Kepmendagri 300.2.2-2138/2025 list behind the admin's address picker. This
command drafts the 74 whose official address is certain; it only creates
pending drafts, which still go through review and publication in the admin.

Judgment calls:
- Prefix only (Desa -> Kel.): the name, kecamatan and kabupaten already match
  a kelurahan code in the official list.
- Kecamatan split or renamed since the address was written: Kota Baru ->
  Alam Barajo, Jambi Timur -> Pasar Jambi, Jambi Selatan -> Paal Merah,
  Air Hangat -> Air Hangat Barat, Pamenang Barat -> Pamenang, "Jaluko" ->
  Jambi Luar Kota, and "Kabupaten Muaro Bungo" -> Bungo. Each desa exists only
  once in that kabupaten, so the move is unambiguous. Lubuk Landai and Tanah
  Bekali land in different kecamatan (Tanah Sepenggal Lintas vs Tanah
  Sepenggal) because that is where the official list places them.
- Spelling: Bandar -> Bendar Sedap, Koto Luar -> Koto Lua, Rawasari -> Rawa
  Sari. "RT 21" is dropped from the Rawa Sari address; Lokasi rekapan and
  Keterangan keep it.
- Nomor is a permanent identifier and keeps its old kecamatan.
- Left out (need a field or boundary check): Tebing Tinggi in Kec. Siulak,
  Betung Bedarah (now Barat/Timur), and Sungai Bahar "Unit 2" / "Unit 5".

Matching is on the exact current address, so points edited since the import
are skipped, as are points that already have a pending draft.
"""
import json
from pathlib import Path
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from survey.models import Account, Draft, Point
from survey.services import save_draft

FIXES = {
    'Desa Durian Luncuk, Kecamatan Batin XXIV, Kabupaten Batang Hari': 'Kel. Durian Luncuk, Kecamatan Batin XXIV, Kabupaten Batang Hari',
    'Desa Dusun Bangko, Kecamatan Bangko, Kabupaten Merangin': 'Kel. Dusun Bangko, Kecamatan Bangko, Kabupaten Merangin',
    'Desa Pematang Kandis, Kecamatan Bangko, Kabupaten Merangin': 'Kel. Pematang Kandis, Kecamatan Bangko, Kabupaten Merangin',
    'Desa Dusun Kebun, Kecamatan Batang Asam, Kabupaten Tanjung Jabung Barat': 'Kel. Dusun Kebun, Kecamatan Batang Asam, Kabupaten Tanjung Jabung Barat',
    'Desa Muara Sabak Ilir, Kecamatan Muara Sabak Timur, Kabupaten Tanjung Jabung Timur': 'Kel. Muara Sabak Ilir, Kecamatan Muara Sabak Timur, Kabupaten Tanjung Jabung Timur',
    'Desa Tempino, Kecamatan Mestong, Kabupaten Muaro Jambi': 'Kel. Tempino, Kecamatan Mestong, Kabupaten Muaro Jambi',
    'Desa Tebing Tinggi, Kecamatan Tebing Tinggi, Kabupaten Tanjung Jabung Barat': 'Kel. Tebing Tinggi, Kecamatan Tebing Tinggi, Kabupaten Tanjung Jabung Barat',
    'Desa Lubuk Landai, Kecamatan Sepenggal Lintas, Kabupaten Muaro Bungo': 'Desa Lubuk Landai, Kecamatan Tanah Sepenggal Lintas, Kabupaten Bungo',
    'Desa Tanah Bekali, Kecamatan Sepenggal Lintas, Kabupaten Muaro Bungo': 'Desa Tanah Bekali, Kecamatan Tanah Sepenggal, Kabupaten Bungo',
    'Kel. Kenali Besar, Kecamatan Kota Baru, Kota Jambi': 'Kel. Kenali Besar, Kecamatan Alam Barajo, Kota Jambi',
    'Kel. Sungai Asam, Kecamatan Jambi Timur, Kota Jambi': 'Kel. Sungai Asam, Kecamatan Pasar Jambi, Kota Jambi',
    'Kel. Bakung Jaya, Kecamatan Jambi Selatan, Kota Jambi': 'Kel. Bakung Jaya, Kecamatan Paal Merah, Kota Jambi',
    'Desa Pematang Gajah, Kecamatan Jaluko, Kabupaten Muaro Jambi': 'Desa Pematang Gajah, Kecamatan Jambi Luar Kota, Kabupaten Muaro Jambi',
    'Desa Hamparan Pugu, Kecamatan Air Hangat, Kabupaten Kerinci': 'Desa Hamparan Pugu, Kecamatan Air Hangat Barat, Kabupaten Kerinci',
    'Desa Tanjung Gedang, Kecamatan Pamenang Barat, Kabupaten Merangin': 'Desa Tanjung Gedang, Kecamatan Pamenang, Kabupaten Merangin',
    'RT 21 Rawasari, Kecamatan Kota Baru, Kota Jambi': 'Kel. Rawa Sari, Kecamatan Alam Barajo, Kota Jambi',
    'Desa Bandar Sedap, Kecamatan Siulak, Kabupaten Kerinci': 'Desa Bendar Sedap, Kecamatan Siulak, Kabupaten Kerinci',
    'Desa Koto Luar, Kecamatan Siulak Mukai, Kabupaten Kerinci': 'Desa Koto Lua, Kecamatan Siulak Mukai, Kabupaten Kerinci',
}
REASON = 'Menyesuaikan alamat dengan daftar wilayah Kepmendagri 300.2.2-2138/2025 agar terbaca pemilih wilayah.'

class Command(BaseCommand):
    help = 'Draft official addresses for imported points. Dry-run unless --apply --actor <username>.'
    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true')
        parser.add_argument('--actor', help='Account recorded as the drafts\' author.')
    def handle(self, **options):
        tree = json.loads((Path(__file__).resolve().parents[2] / 'data' / 'wilayah-jambi.json').read_text(encoding='utf-8'))
        official = {f'{desa}, Kecamatan {kec["nama"]}, {kab["nama"]}' for kab in tree for kec in kab['kecamatan'] for desa in kec['desa']}
        if not set(FIXES.values()) <= official:
            raise CommandError(f'Not in the official list: {sorted(set(FIXES.values()) - official)}')
        actor = None
        if options['apply']:
            actor = Account.objects.filter(username=options['actor'] or '', is_active=True).first()
            if not actor:
                raise CommandError('--apply needs --actor with an active account.')
        pending = set(Draft.objects.filter(status='pending').values_list('point_id', flat=True))
        drafted = skipped = 0
        with transaction.atomic():
            for point in Point.objects.filter(state__alamat__in=list(FIXES)).order_by('nomor'):
                if point.id in pending:
                    skipped += 1
                    self.stdout.write(f'skip (pending draft) {point.nomor}')
                    continue
                state = dict(point.state, alamat=FIXES[point.state['alamat']])
                self.stdout.write(f'{point.nomor}: {point.state["alamat"]} -> {state["alamat"]}')
                if actor:
                    save_draft(actor, str(point.id), point.revision, {'state': state, 'new_observation': None}, REASON)
                drafted += 1
        self.stdout.write(f'{"Drafted" if actor else "Would draft"} {drafted}, skipped {skipped} with a pending draft.')
