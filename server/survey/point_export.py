import re
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
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.utils.units import pixels_to_EMU
from openpyxl.worksheet.properties import PageSetupProperties
from PIL import Image

from delivery import storage
from delivery.models import PublishedMedia
from .domain import Problem
from .media import MAX_BYTES
from .models import Photo


PHOTO_WIDTH = 28  # Excel column width in characters, about 201 pixels at the default scale.
PHOTO_BOX = 200  # Tallest photo, in pixels. Survey photos are portrait, ~150x200 here.
# Identity first, then where, then what was found, then the photo: the photo
# column is wide and used to sit fourth, splitting the text columns.
# The address ("Desa X, Kecamatan Y, Kabupaten Z") is split into its own
# columns instead of repeating the kabupaten in one long cell.
# Each column is as wide as its longest value, kept between a minimum and a
# maximum; past the maximum the text wraps and the row grows instead.
FIELDS = (
    ('No', 'no', 5, 7), ('Nomor', 'nomor', 16, 44), ('Kabupaten/Kota', 'region', 14, 26),
    ('Kecamatan', 'kecamatan', 12, 24), ('Desa/Kelurahan', 'desa', 14, 28),
    ('Lokasi Rekapan', 'lokasi_rekapan', 16, 36), ('Keterangan', 'keterangan', 12, 30), ('Jalur', 'jalur', 9, 16),
    ('Status Verifikasi', 'verification', 16, 16), ('Latitude', 'lat', 11, 11), ('Longitude', 'lon', 11, 11),
    ('Tanggal Dokumentasi', 'date', 13, 13), ('Catatan', 'catatan', 14, 45),
    ('Foto Survei', 'photo_id', PHOTO_WIDTH, PHOTO_WIDTH),
)
PHOTO_COLUMN = next(column for column, field in enumerate(FIELDS) if field[1] == 'photo_id')
CENTERED = {'no', 'verification', 'lat', 'lon', 'date', 'photo_id'}
ROW_FONT = Font(name='Arial', size=10, color='FF000000')
HEADER_FONT = Font(name='Arial', size=10, bold=True, color='FFFFFFFF')
HEADER_FILL = PatternFill('solid', fgColor='FF00458F')  # The admin's deep blue.
EDGE = Side(style='thin', color='FFC9D4DE')
BORDER = Border(left=EDGE, right=EDGE, top=EDGE, bottom=EDGE)
HEADER_ALIGNMENT = Alignment(horizontal='center', vertical='center', wrap_text=True)
# Vertically centred: most rows are as tall as their photo, and text pinned to
# the top left a band of empty cell under every value.
TEXT_ALIGNMENT = Alignment(horizontal='left', vertical='center', wrap_text=True)
CENTER_ALIGNMENT = Alignment(horizontal='center', vertical='center', wrap_text=True)
# The map's colours for the two statuses that need attention; "Titik pasti" stays plain.
STATUS_STYLE = {
    'Perlu verifikasi': (PatternFill('solid', fgColor='FFFFF1DE'), Font(name='Arial', size=10, bold=True, color='FFB45309')),
    'Belum ditetapkan': (PatternFill('solid', fgColor='FFEEF2F6'), Font(name='Arial', size=10, italic=True, color='FF52606D')),
}
MISSING_PHOTO_FONT = Font(name='Arial', size=10, italic=True, color='FF7B8794')
# A lone dash was typed as "nothing to note"; it exports as an empty cell.
PLACEHOLDERS = {'-', '–', '—'}
LINE_POINTS = 12.75  # One line of 10pt Arial.
TITLE = 'Titik Survei PUTS 2026'
EXPORT_LOCK = Lock()


def clean(value, *, verbatim=False):
    """Text as an Excel cell value: control characters removed, blank or
    placeholder text as None. Lokasi rekapan is only trimmed, never re-spaced:
    crews search by its exact text."""
    if not isinstance(value, str):
        return value
    text = ILLEGAL_CHARACTERS_RE.sub(' ', value).strip()
    if not verbatim:
        text = '\n'.join(re.sub(r'[ \t]+', ' ', line).strip() for line in text.splitlines() if line.strip())
    return None if not text or text in PLACEHOLDERS else text


def place_parts(row, regions, aliases):
    """Kabupaten, kecamatan and desa for one point. The address is written
    by the admin's wilayah picker as "Desa X, Kecamatan Y, Kabupaten Z"; an
    address in any other shape falls back to the parts of the nomor."""
    prefix = row['nomor'].split('-', 1)[0].upper()
    region = regions.get(aliases.get(prefix, prefix), prefix.title())
    parts = [part.strip() for part in (row['state'].get('alamat') or '').split(',')]
    if len(parts) == 3 and parts[1].startswith('Kecamatan '):
        return region, parts[1].removeprefix('Kecamatan '), parts[0]
    nomor = row['nomor'].split('-')
    return region, nomor[1] if len(nomor) == 4 else None, nomor[2] if len(nomor) == 4 else None


def text_units(text, bold=False):
    """Approximate width of text in Excel column units (the width of "0" in
    the default font). 10pt Arial capitals and digits are about one unit,
    lower case narrower, spaces and punctuation narrower still; the nomor is
    all capitals, so counting characters alone made its column too narrow."""
    units = sum(1.0 if char.isupper() or char.isdigit() else 0.5 if char in ' .,;:-/()\'"' else 0.82 for char in text)
    return units * (1.08 if bold else 1)


def wrapped_lines(text, width, bold=False):
    """How many lines a wrapping cell needs, wrapping at spaces as Excel does."""
    room = max(1.0, width - 1.2)  # The cell's own padding.
    lines = 0
    for paragraph in str(text).split('\n'):
        lines += 1
        current = 0.0
        for word in paragraph.split(' '):
            size = text_units(word, bold)
            needed = size if current == 0 else current + 0.5 + size
            if needed <= room:
                current = needed
                continue
            if current > 0:
                lines += 1
            while size > room:  # A word longer than the cell breaks across lines.
                lines += 1
                size -= room
            current = size
    return lines


def column_widths(records):
    """Each column fits its longest value within its limits. Headers wrap
    over two lines, so only their longest word must fit."""
    widths = []
    for column, (label, field, low, high) in enumerate(FIELDS):
        longest = max(text_units(word, True) for word in label.split(' '))
        for values, _ in records:
            value = values[column]
            if isinstance(value, str) and field != 'photo_id':
                longest = max(longest, max(text_units(line) for line in value.split('\n')))
        widths.append(round(min(high, max(low, longest + 2)), 1))
    return widths


def row_height(values, widths, bold=False):
    """Points for a row that shows every wrapped line: openpyxl cannot ask
    Excel to autofit, and a fixed height either clipped long notes or left gaps."""
    lines = max([wrapped_lines(value, width, bold) for (_, field, *_), value, width in zip(FIELDS, values, widths)
        if isinstance(value, str) and field != 'photo_id'] or [1])
    return lines * LINE_POINTS + 9


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


# Every row with a photo gets the same height, whatever the photo's shape, so the table reads as an even grid.
PHOTO_ROW_POINTS = (PHOTO_BOX + 12) * 0.75


def place_photo(sheet, image, row, row_points):
    """Anchors the photo centred in its cell, shrunk to fit the photo box."""
    cell_width = int(PHOTO_WIDTH * 7 + 5)  # Excel's pixel width for a column at the default font.
    scale = min(1, (cell_width - 12) / image.width, PHOTO_BOX / image.height)
    width, height = max(1, round(image.width * scale)), max(1, round(image.height * scale))
    left, top = (cell_width - width) // 2, max(6, round((row_points / 0.75 - height) / 2))
    image.anchor = TwoCellAnchor(editAs='twoCell',
        _from=AnchorMarker(col=PHOTO_COLUMN, row=row - 1, colOff=pixels_to_EMU(left), rowOff=pixels_to_EMU(top)),
        to=AnchorMarker(col=PHOTO_COLUMN, row=row - 1, colOff=pixels_to_EMU(left + width), rowOff=pixels_to_EMU(top + height)))
    sheet.add_image(image)


def style_header(cell):
    cell.font, cell.fill, cell.alignment, cell.border = HEADER_FONT, HEADER_FILL, HEADER_ALIGNMENT, BORDER


def prepare_print(sheet, title):
    """Landscape A4, one page wide, page numbers in the footer."""
    sheet.page_setup.orientation = 'landscape'
    sheet.page_setup.paperSize = sheet.PAPERSIZE_A4
    sheet.page_setup.fitToWidth, sheet.page_setup.fitToHeight = 1, 0
    sheet.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)
    sheet.page_margins.left = sheet.page_margins.right = 0.4
    sheet.page_margins.top = sheet.page_margins.bottom = 0.6
    sheet.print_options.horizontalCentered = True
    sheet.oddHeader.left.text = title
    sheet.oddFooter.right.text = 'Halaman &P dari &N'


def write_points(sheet, rows, photos, revoked, regions, aliases):
    """The point table, one row per official allocation."""
    sheet.title = 'Titik Survei'
    sheet.freeze_panes = 'C2'  # No and Nomor stay in view while scrolling right.
    prepare_print(sheet, TITLE)
    sheet.print_title_rows = '1:1'  # The header repeats on every printed page.

    # Grouped as the admin list reads: kabupaten, kecamatan, desa, then unit number.
    placed = sorted(((place_parts(row, regions, aliases), row) for row in rows),
        key=lambda item: (item[0][0], item[0][1] or '', item[0][2] or '', item[1]['nomor']))
    # Values first, then sizes: a column's width depends on every row in it.
    records = []
    for index, ((region, kecamatan, desa), row) in enumerate(placed, 1):
        state = row['state']
        values = {field: clean(state.get(field), verbatim=field == 'lokasi_rekapan')
            for field in ('lokasi_rekapan', 'keterangan', 'jalur', 'catatan')}
        values.update(no=index, nomor=clean(row['nomor']), region=region, kecamatan=kecamatan, desa=desa,
            lat=state.get('lat'), lon=state.get('lon'),
            date=date.fromisoformat(state['date']) if state.get('date') else None,
            verification='Perlu verifikasi' if state['duplikat'] else 'Titik pasti')
        if state['status'] == 'Belum Ditetapkan':
            # The pin is only an estimate until the unit is sited.
            values.update(lat=None, lon=None, verification='Belum ditetapkan')
        photo_id = state.get('photo_id')
        photo = photos.get(photo_id)
        image = photo_image(photo) if photo and photo.point_id == row['id'] and photo.id not in revoked else None
        values['photo_id'] = None if image else ('Foto tidak tersedia' if photo_id else 'Belum ada foto survei')

        records.append(([values.get(field[1]) for field in FIELDS], image))

    widths = column_widths(records)
    labels = [field[0] for field in FIELDS]
    sheet.row_dimensions[1].height = max(30, row_height(labels, widths, bold=True))
    for column, (label, width) in enumerate(zip(labels, widths), 1):
        sheet.column_dimensions[get_column_letter(column)].width = width
        style_header(sheet.cell(1, column, label))

    for row_number, (ordered, image) in enumerate(records, 2):
        height = max(22, row_height(ordered, widths), PHOTO_ROW_POINTS if image else 0)
        sheet.row_dimensions[row_number].height = height
        if image:
            place_photo(sheet, image, row_number, height)
        for column, ((_, field, *_), value) in enumerate(zip(FIELDS, ordered), 1):
            cell = sheet.cell(row_number, column)
            cell.value = value
            if isinstance(value, str):
                cell.data_type = 's'  # Preserve entered text without interpreting it as a formula.
            cell.font, cell.border = ROW_FONT, BORDER
            cell.alignment = CENTER_ALIGNMENT if field in CENTERED else TEXT_ALIGNMENT
            if field in ('lat', 'lon'):
                cell.number_format = '0.000000'
            elif field == 'date':
                cell.number_format = 'dd/mm/yyyy'
            elif field == 'photo_id' and value:
                cell.font = MISSING_PHOTO_FONT
            elif field == 'verification' and value in STATUS_STYLE:
                cell.fill, cell.font = STATUS_STYLE[value]


def write_workbook(output, rows, regions, aliases):
    if not rows:
        raise Problem('Tidak ada titik survei yang cocok dengan kabupaten/kota dan pencarian ini.', 404)
    photo_ids = {row['state']['photo_id'] for row in rows if row['state'].get('photo_id')}
    photos = {str(photo.id): photo for photo in Photo.objects.filter(id__in=photo_ids, ready=True)}
    revoked = set(PublishedMedia.objects.filter(id__in=photo_ids, revoked=True).values_list('id', flat=True))

    book = Workbook()
    book.properties.title = TITLE
    book.properties.creator = 'Dinas ESDM Provinsi Jambi'
    write_points(book.active, rows, photos, revoked, regions, aliases)
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
