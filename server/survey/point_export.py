from contextlib import closing
from datetime import date
from hashlib import sha256
from io import BytesIO
from tempfile import TemporaryFile
from threading import Lock

from botocore.exceptions import BotoCoreError, ClientError
from openpyxl import Workbook
from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE
from openpyxl.drawing.image import Image as ExcelImage
from openpyxl.drawing.spreadsheet_drawing import AnchorMarker, TwoCellAnchor
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.utils.units import pixels_to_EMU
from PIL import Image

from delivery import storage
from delivery.models import PublishedMedia
from .domain import Problem
from .media import MAX_BYTES
from .models import Photo


PHOTO_WIDTH = 44  # Excel column width in characters, about 308 pixels at the default scale.
FIELDS = (
    ('Nomor', 'nomor', 38), ('Kabupaten/Kota', 'region', 28), ('Alamat', 'alamat', 48),
    ('Foto Survei', 'photo_id', PHOTO_WIDTH),
    ('Latitude', 'lat', 17), ('Longitude', 'lon', 17), ('Status Verifikasi', 'verification', 22),
    ('Tanggal Dokumentasi', 'date', 24), ('Jalur', 'jalur', 18), ('Lokasi Rekapan', 'lokasi_rekapan', 34),
    ('Keterangan', 'keterangan', 30), ('Catatan', 'catatan', 32),
)
PHOTO_COLUMN = next(column for column, (_, field, _) in enumerate(FIELDS) if field == 'photo_id')
ROW_FONT = Font(name='Arial', size=10, color='FF000000')
HEADER_FONT = Font(name='Arial', size=10, bold=True, color='FFFFFFFF')
HEADER_FILL = PatternFill('solid', fgColor='FF555555')
ALIGNMENT = Alignment(vertical='center', wrap_text=True)
EXPORT_LOCK = Lock()


def photo_image(photo):
    try:
        with closing(storage.get(photo.derivative_key)) as stream:
            raw = stream.read(MAX_BYTES + 1)
    except FileNotFoundError:
        return None
    except ClientError as error:
        if error.response['Error']['Code'] in ('404', 'NoSuchKey', 'NotFound'):
            return None
        raise Problem('Penyimpanan foto sedang tidak tersedia. Coba ekspor lagi.', 503) from error
    except (BotoCoreError, OSError) as error:
        raise Problem('Penyimpanan foto sedang tidak tersedia. Coba ekspor lagi.', 503) from error

    if len(raw) > MAX_BYTES or sha256(raw).hexdigest() != photo.derivative_checksum:
        return None
    with BytesIO(raw) as source, BytesIO() as compressed:
        try:
            with Image.open(source, formats=['JPEG']) as image:
                image.thumbnail((768, 768))
                image.save(compressed, format='JPEG', quality=85)
        except (OSError, ValueError, Image.DecompressionBombError):
            return None
        return ExcelImage(BytesIO(compressed.getvalue()))


def place_photo(sheet, image, row):
    cell_width = PHOTO_WIDTH * 7
    scale = min(1, (cell_width - 12) / image.width, 224 / image.height)
    width, height = max(1, round(image.width * scale)), max(1, round(image.height * scale))
    left = (cell_width - width) // 2
    image.anchor = TwoCellAnchor(editAs='twoCell',
        _from=AnchorMarker(col=PHOTO_COLUMN, row=row - 1, colOff=pixels_to_EMU(left), rowOff=pixels_to_EMU(6)),
        to=AnchorMarker(col=PHOTO_COLUMN, row=row - 1, colOff=pixels_to_EMU(left + width), rowOff=pixels_to_EMU(6 + height)))
    sheet.add_image(image)
    sheet.row_dimensions[row].height = max(28, (height + 12) * 0.75)


def write_workbook(output, rows, regions, aliases):
    if not rows:
        raise Problem('Tidak ada titik survei yang cocok dengan kabupaten/kota dan pencarian ini.', 404)
    photo_ids = {row['state']['photo_id'] for row in rows if row['state'].get('photo_id')}
    photos = {str(photo.id): photo for photo in Photo.objects.filter(id__in=photo_ids, ready=True)}
    revoked = set(PublishedMedia.objects.filter(id__in=photo_ids, revoked=True).values_list('id', flat=True))

    book = Workbook()
    sheet = book.active
    sheet.title = 'Titik Survei'
    sheet.freeze_panes = 'B2'
    sheet.row_dimensions[1].height = 28
    for column, (label, _, width) in enumerate(FIELDS, 1):
        sheet.column_dimensions[get_column_letter(column)].width = width
        cell = sheet.cell(1, column, label)
        cell.font, cell.fill, cell.alignment = HEADER_FONT, HEADER_FILL, ALIGNMENT

    for row_number, row in enumerate(rows, 2):
        state = row['state']
        prefix = row['nomor'].split('-', 1)[0].upper()
        values = dict(state, nomor=row['nomor'], region=regions.get(aliases.get(prefix, prefix), prefix.title()),
            date=date.fromisoformat(state['date']) if state.get('date') else None,
            verification='Perlu verifikasi' if state['duplikat'] else 'Titik pasti')
        if state['status'] == 'Belum Ditetapkan':
            values.update(lat=None, lon=None, verification='Belum ditetapkan')
        photo_id = state.get('photo_id')
        photo = photos.get(photo_id)
        if photo and photo.point_id == row['id'] and photo.id not in revoked:
            image = photo_image(photo)
        else:
            image = None
        values['photo_id'] = None if image else ('Foto tidak tersedia' if photo_id else 'Belum ada foto survei')
        sheet.row_dimensions[row_number].height = 42
        if image:
            place_photo(sheet, image, row_number)
        for column, (_, field, _) in enumerate(FIELDS, 1):
            value = values.get(field)
            cell = sheet.cell(row_number, column)
            if isinstance(value, str):
                cell.value = ILLEGAL_CHARACTERS_RE.sub(' ', value)
                cell.data_type = 's'  # Preserve entered text without interpreting it as a formula.
            else:
                cell.value = value
            if field in ('lat', 'lon'):
                cell.number_format = '0.000000######'
            elif field == 'date':
                cell.number_format = 'dd/mm/yyyy'
            cell.font, cell.alignment = ROW_FONT, ALIGNMENT

    book.save(output)


def point_workbook(rows, regions, aliases):
    if not EXPORT_LOCK.acquire(blocking=False):
        raise Problem('Ekspor Excel lain sedang diproses. Coba sebentar lagi.', 429)
    try:
        output = TemporaryFile()
        try:
            write_workbook(output, list(rows), regions, aliases)
            output.seek(0)
            return output
        except BaseException:
            output.close()
            raise
    finally:
        EXPORT_LOCK.release()
