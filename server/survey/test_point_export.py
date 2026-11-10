from io import BytesIO
from tempfile import TemporaryDirectory
from zipfile import ZipFile

from django.test import TestCase, override_settings
from openpyxl import load_workbook
from PIL import Image

from .media import store_photo
from .models import Account, Point


class PointExportTests(TestCase):
    def setUp(self):
        self.publisher = Account.objects.create_user('export-publisher', password='publisher-test-password', role='publisher')
        self.client.post('/admin/login', {'username': self.publisher.username, 'password': 'publisher-test-password'})

    def point(self, nomor, **changes):
        state = dict(nomor=nomor, nama='Pengusul', jalur='', alamat='Lokasi survei', keterangan='',
            lokasi_rekapan='', catatan='', status='', duplikat=False, archived=False,
            lon=103.6, lat=-1.6, date='2026-09-01', photo_id=None, observation_id=None)
        state.update(changes)
        return Point.objects.create(nomor=nomor, state=state, archived=state['archived'])

    def photo(self, point, color):
        raw = BytesIO()
        Image.new('RGB', (72, 100), color).save(raw, format='JPEG')
        return store_photo(raw.getvalue(), f'{color}.jpg', self.publisher, point)

    def test_list_combines_region_search_and_confirmed_status(self):
        self.point('BUNGO-KEC-DESA-001', nama='Tim A')
        self.point('Muaro Bungo-KEC-DESA-002', nama='Tim A')
        self.point('BUNGO-KEC-DESA-003', nama='Tim B')
        self.point('BUNGO-KEC-DESA-004', nama='Tim A', duplikat=True)
        self.point('KOTA JAMBI-KEC-DESA-001', nama='Tim A')
        bootstrap = self.client.get('/admin/api/bootstrap').json()
        self.assertIn({'value': 'KOTA SUNGAI PENUH', 'label': 'Kota Sungai Penuh'}, bootstrap.get('regions', []))
        result = self.client.get('/admin/api/points', {'region': 'BUNGO', 'status': 'pasti', 'q': 'Tim A'})
        self.assertEqual({item['state']['nomor'] for item in result.json()['items']},
            {'BUNGO-KEC-DESA-001', 'Muaro Bungo-KEC-DESA-002'})
        # "Alokasi resmi" counts what the overview and the export count: points needing
        # verification and not-yet-sited ones in, reserves and archived points out.
        self.point('BUNGO-KEC-DESA-005', status='Belum Ditetapkan')
        self.point('BUNGO-KEC-DESA-006', status='Cadangan')
        self.point('BUNGO-KEC-DESA-007', archived=True)
        official = self.client.get('/admin/api/points', {'region': 'BUNGO', 'status': 'resmi', 'archived': 1})
        self.assertEqual({item['state']['nomor'] for item in official.json()['items']},
            {'BUNGO-KEC-DESA-001', 'Muaro Bungo-KEC-DESA-002', 'BUNGO-KEC-DESA-003', 'BUNGO-KEC-DESA-004', 'BUNGO-KEC-DESA-005'})

    def test_workbook_includes_official_points_and_embeds_each_current_photo(self):
        first = self.point('BUNGO-KEC-DESA-001', catatan='=1+1', keterangan='RT 02\x0b  Olak', jalur='-',
            alamat='Desa Olak, Kecamatan Muara Bungo, Kabupaten Bungo')
        second = self.point('KOTA JAMBI-KEC-DESA-001')
        missing = self.point('KOTA JAMBI-KEC-DESA-002')
        self.point('KOTA JAMBI-KEC-DESA-003', status='Cadangan')
        pending = self.point('KOTA JAMBI-KEC-DESA-004', status='Belum Ditetapkan')
        verify = self.point('KOTA JAMBI-KEC-DESA-005', duplikat=True)
        self.point('KOTA JAMBI-KEC-DESA-006', archived=True)

        with TemporaryDirectory() as root, override_settings(STORAGE_ROOT=root):
            self.photo(first, 'blue')  # An older photo must not replace the selected one.
            for point, color in ((first, 'red'), (second, 'green'), (verify, 'yellow')):
                point.state['photo_id'] = str(self.photo(point, color).id)
                point.save(update_fields=['state'])
            result = self.client.get('/admin/api/export.xlsx', {'page': 2, 'status': 'Cadangan', 'archived': 1})
            self.assertEqual(result.status_code, 200)
            self.assertEqual(result['Cache-Control'], 'private, no-store')
            self.assertIn('attachment;', result['Content-Disposition'])
            self.assertRegex(result['Content-Disposition'], r'filename="Titik Survei PUTS 2026 - Semua Kabupaten-Kota - \d{4}-\d{2}-\d{2}\.xlsx"')
            content = b''.join(result.streaming_content)
            region_result = self.client.get('/admin/api/export.xlsx', {'region': 'KOTA JAMBI', 'q': second.nomor})
            self.assertEqual(region_result.status_code, 200)
            self.assertRegex(region_result['Content-Disposition'],
                r'filename="Titik Survei PUTS 2026 - Kota Jambi - Cari KOTA JAMBI-KEC-DESA-001 - \d{4}-\d{2}-\d{2}\.xlsx"')
            region_sheet = load_workbook(BytesIO(b''.join(region_result.streaming_content))).active
            self.assertEqual([cells[1] for cells in list(region_sheet.values)[1:]], [second.nomor])

        book = load_workbook(BytesIO(content))
        self.assertEqual(book.sheetnames, ['Titik Survei'])
        sheet = book.active
        self.assertEqual([cells[:2] for cells in list(sheet.values)[1:]],
            [(1, first.nomor), (2, second.nomor), (3, missing.nomor), (4, pending.nomor), (5, verify.nomor)])
        headers = {cell.value: cell.column for cell in sheet[1]}
        self.assertNotIn('Nama Anggota', headers)
        self.assertNotIn('Alamat', headers)
        self.assertEqual(list(headers)[-1], 'Foto Survei')
        self.assertIsNone(sheet.auto_filter.ref)
        self.assertEqual(sheet.freeze_panes, 'C2')
        self.assertEqual(sheet.print_title_rows, '$1:$1')
        self.assertEqual(sheet.cell(2, headers['Catatan']).data_type, 's')
        self.assertEqual(sheet.cell(2, headers['Catatan']).value, '=1+1')
        # The address splits into its own columns; an address in another shape falls back to the nomor.
        self.assertEqual((sheet.cell(2, headers['Kabupaten/Kota']).value, sheet.cell(2, headers['Kecamatan']).value,
            sheet.cell(2, headers['Desa/Kelurahan']).value), ('Kabupaten Bungo', 'Muara Bungo', 'Desa Olak'))
        self.assertEqual(sheet.cell(3, headers['Kecamatan']).value, 'KEC')
        self.assertEqual(sheet.cell(2, headers['Keterangan']).value, 'RT 02 Olak')
        self.assertIsNone(sheet.cell(2, headers['Jalur']).value)
        self.assertEqual(sheet.cell(2, headers['Latitude']).value, -1.6)
        self.assertEqual(sheet.cell(2, headers['Latitude']).number_format, '0.000000')
        self.assertEqual(sheet.cell(4, headers['Foto Survei']).value, 'Belum ada foto survei')
        self.assertEqual(sheet.cell(5, headers['Status Verifikasi']).value, 'Belum ditetapkan')
        self.assertIsNone(sheet.cell(5, headers['Latitude']).value)
        self.assertIsNone(sheet.cell(5, headers['Longitude']).value)
        self.assertEqual(sheet.cell(6, headers['Status Verifikasi']).value, 'Perlu verifikasi')
        # Every column fits its content within limits; every row with a photo has the same height.
        self.assertGreaterEqual(sheet.column_dimensions['B'].width, 20)
        self.assertEqual({sheet.row_dimensions[row].height for row in (2, 3, 6)}, {159.0})
        self.assertLess(sheet.row_dimensions[4].height, 159.0)
        self.assertEqual([image.anchor._from.row for image in sheet._images], [1, 2, 5])
        self.assertEqual([image.anchor._from.col for image in sheet._images], [headers['Foto Survei'] - 1] * 3)
        with ZipFile(BytesIO(content)) as archive:
            embedded = [name for name in archive.namelist() if name.startswith('xl/media/')]
            colors = [Image.open(BytesIO(archive.read(name))).getpixel((0, 0)) for name in embedded]
        self.assertGreater(colors[0][0], 240)
        self.assertGreater(colors[1][1], 110)

    def test_download_requires_publishing_permission(self):
        self.client.logout()
        self.assertEqual(self.client.get('/admin/api/export.xlsx').status_code, 401)
        Account.objects.create_user('export-editor', password='editor-test-password', role='editor')
        self.client.post('/admin/login', {'username': 'export-editor', 'password': 'editor-test-password'})
        self.assertEqual(self.client.get('/admin/api/export.xlsx').status_code, 403)
